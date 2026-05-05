import { PrismaClient } from '@prisma/client';
import { classifyIntentAndTemperature, generateAiResponse } from './aiService';
import { sendTextMessage } from './zapiService';
import { emitNewMessage, emitConversationUpdate, emitNewConversation } from '../socket';
import { triggerFlowsByEvent } from './flowEngine';

const prisma = new PrismaClient();

export async function processZapiWebhook(payload: any): Promise<void> {
  try {
    if (!payload.phone || !payload.text?.message) return;

    const phone = payload.phone.replace(/\D/g, '').replace(/^55/, '');
    const content = payload.text.message;
    const providerMessageId = payload.messageId;

    // 1. Criar/atualizar contato
    let contact = await prisma.contact.findUnique({ where: { phone } });
    const contactName = payload.senderName || payload.phone || phone;

    if (!contact) {
      contact = await prisma.contact.create({
        data: { name: contactName, phone },
      });
    }

    // 2. Distribuição: encontrar loja/vendedor por região ou padrão
    const defaultStore = await prisma.store.findFirst({ where: { active: true } });
    const defaultUser = defaultStore
      ? await prisma.user.findFirst({
          where: { storeId: defaultStore.id, role: { in: ['VENDEDOR', 'ATENDENTE'] }, active: true },
        })
      : null;

    // 3. Criar/atualizar lead
    let lead = await prisma.lead.findFirst({ where: { phone } });
    const isNewLead = !lead;

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          name: contactName,
          phone,
          source: 'WhatsApp',
          contactId: contact.id,
          storeId: defaultStore?.id,
          assignedUserId: defaultUser?.id,
        },
      });
    }

    // 4. Encontrar ou criar conversa
    let conversation = await prisma.conversation.findFirst({
      where: { contactId: contact.id, status: { in: ['ABERTA', 'EM_ATENDIMENTO', 'AGUARDANDO'] } },
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
          lastMessageAt: new Date(),
        },
      });
    }

    // 5. Salvar mensagem recebida
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        type: 'TEXT',
        content,
        providerMessageId,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // 6. Classificar intenção/temperatura/score
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
        description: `Mensagem recebida de ${phone}`,
        data: JSON.stringify({ classification }),
        conversationId: conversation.id,
        leadId: lead.id,
      },
    });

    // 8. Emitir eventos Socket.IO
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
        lastMessageAt: conversation.lastMessageAt,
        temperature: classification.temperature,
      });
    }

    // 9. Verificar fluxos por palavra-chave
    await triggerFlowsByEvent('KEYWORD', content, conversation.id, lead.id);
    if (isNewLead) {
      await triggerFlowsByEvent('FIRST_MESSAGE', content, conversation.id, lead.id);
      await triggerFlowsByEvent('LEAD_CREATED', content, conversation.id, lead.id);
    }

    // 10. Resposta por IA se habilitada
    const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    if (!freshConv?.aiEnabled || freshConv.mode === 'HUMANO') return;

    const recentMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const chatHistory = recentMessages.map(m => ({
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

    // 11. Enviar pelo Z-API
    await sendTextMessage(phone, aiReply, conversation.storeId).catch(err =>
      console.error('Z-API send error:', err.message)
    );

    // 12. Emitir resposta em tempo real
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
