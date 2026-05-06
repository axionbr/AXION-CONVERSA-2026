import { PrismaClient } from '@prisma/client';
import { classifyIntentAndTemperature, generateAiResponse } from './aiService';
import { sendTextMessage } from './zapiService';
import { emitNewMessage, emitConversationUpdate, emitNewConversation } from '../socket';
import { triggerFlowsByEvent } from './flowEngine';

const prisma = new PrismaClient();

// Status válidos de conversa aberta
const OPEN_STATUSES = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];

function extractPayload(payload: any): { phone: string; content: string; messageId?: string; senderName?: string } | null {
  // Z-API só processa callbacks de mensagem recebida
  if (payload.type && payload.type !== 'ReceivedCallback') return null;

  // Ignorar mensagens de grupos
  if (payload.isGroup) return null;

  const phone = payload.phone || payload.from;
  if (!phone) return null;

  // Suporte a diferentes estruturas do payload Z-API
  const content =
    payload.text?.message ||
    payload.body ||
    payload.message?.conversation ||
    payload.message?.extendedTextMessage?.text;

  if (!content || typeof content !== 'string') return null;

  return {
    phone,
    content,
    messageId: payload.messageId || payload.id,
    senderName: payload.senderName || payload.pushName || phone,
  };
}

export async function processZapiWebhook(payload: any): Promise<void> {
  try {
    const extracted = extractPayload(payload);
    if (!extracted) return;

    const { phone, content, messageId, senderName } = extracted;

    // Normalizar telefone: remover não-dígitos e prefixo 55
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^55/, '');
    if (normalizedPhone.length < 10) return;

    // 1. Criar ou atualizar contato pelo telefone
    let contact = await prisma.contact.findUnique({ where: { phone: normalizedPhone } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: { name: senderName!, phone: normalizedPhone },
      });
    } else if (contact.name !== senderName && senderName !== normalizedPhone) {
      await prisma.contact.update({ where: { id: contact.id }, data: { name: senderName } });
    }

    // 2. Loja e vendedor padrão para distribuição
    const defaultStore = await prisma.store.findFirst({ where: { active: true } });
    const defaultUser = defaultStore
      ? await prisma.user.findFirst({
          where: { storeId: defaultStore.id, role: { in: ['VENDEDOR', 'ATENDENTE'] }, active: true },
        })
      : null;

    // 3. Criar ou atualizar lead
    let lead = await prisma.lead.findFirst({ where: { phone: normalizedPhone } });
    const isNewLead = !lead;

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          name: senderName!,
          phone: normalizedPhone,
          source: 'WhatsApp',
          contactId: contact.id,
          storeId: defaultStore?.id,
          assignedUserId: defaultUser?.id,
        },
      });
    }

    // 4. Encontrar conversa aberta ou criar nova
    let conversation = await prisma.conversation.findFirst({
      where: { contactId: contact.id, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });

    const isNewConversation = !conversation;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          contactId: contact.id,
          leadId: lead.id,
          storeId: defaultStore?.id,
          assignedUserId: defaultUser?.id,
          status: 'NOVO',
          lastMessageAt: new Date(),
        },
      });
    } else {
      // Se estava aguardando cliente, volta para em_atendimento
      if (conversation.status === 'AGUARDANDO_CLIENTE') {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'EM_ATENDIMENTO' },
        });
      }
    }

    // 5. Salvar mensagem recebida e incrementar não-lidos
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        type: 'TEXT',
        content,
        providerMessageId: messageId,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        unreadCount: { increment: 1 },
      },
    });

    // 6. Classificar intenção, temperatura e score
    const classification = await classifyIntentAndTemperature(content);
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        temperature: classification.temperature,
        score: Math.max(lead.score, classification.score),
      },
    });

    // 7. Log de automação
    await prisma.automationLog.create({
      data: {
        type: 'WEBHOOK_RECEIVED',
        description: `Mensagem recebida de ${normalizedPhone}`,
        data: JSON.stringify({ classification }),
        conversationId: conversation.id,
        leadId: lead.id,
      },
    });

    // 8. Emitir eventos Socket.IO em tempo real
    const messagePayload = {
      id: message.id,
      conversationId: conversation.id,
      direction: message.direction,
      type: message.type,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    };

    emitNewMessage(conversation.id, messagePayload);

    if (isNewConversation) {
      emitNewConversation({ conversationId: conversation.id, contact, lead });
    } else {
      emitConversationUpdate(conversation.id, {
        lastMessageAt: new Date(),
        unreadCount: (conversation.unreadCount ?? 0) + 1,
        temperature: classification.temperature,
      });
    }

    // 9. Verificar fluxos por gatilho
    await triggerFlowsByEvent('KEYWORD', content, conversation.id, lead.id);
    if (isNewLead) {
      await triggerFlowsByEvent('FIRST_MESSAGE', content, conversation.id, lead.id);
      await triggerFlowsByEvent('LEAD_CREATED', content, conversation.id, lead.id);
    }

    // 10. Resposta por IA se habilitada e modo não-humano
    const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    if (!freshConv?.aiEnabled || freshConv.mode === 'HUMANO') return;

    const recentMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const chatHistory = recentMessages.map((m) => ({
      role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

    const aiReply = await generateAiResponse(conversation.id, chatHistory, conversation.storeId);
    if (!aiReply) return;

    const aiMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        content: aiReply,
      },
    });

    // 11. Enviar resposta pelo Z-API
    await sendTextMessage(normalizedPhone, aiReply, conversation.storeId).catch(err =>
      console.error('Z-API send error:', err.message)
    );

    // 12. Emitir resposta da IA em tempo real
    emitNewMessage(conversation.id, {
      id: aiMessage.id,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content: aiReply,
      createdAt: aiMessage.createdAt.toISOString(),
    });

    await prisma.automationLog.create({
      data: {
        type: 'AI_RESPONSE',
        description: `IA respondeu na conversa ${conversation.id}`,
        data: null,
        conversationId: conversation.id,
        leadId: lead.id,
      },
    });
  } catch (err: any) {
    console.error('Webhook processing error:', err.message);
    throw err;
  }
}
