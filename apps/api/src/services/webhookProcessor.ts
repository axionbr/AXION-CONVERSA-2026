import { PrismaClient } from '@prisma/client';
import { classifyIntentAndTemperature, generateAiResponse } from './aiService';
import { sendTextMessage } from './zapiService';
import { emitNewMessage, emitConversationUpdate, emitNewConversation } from '../socket';
import { triggerFlowsByEvent } from './flowEngine';

const prisma = new PrismaClient();

const OPEN_STATUSES      = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];
const AI_BLOCKED_MODES   = ['HUMANO', 'PAUSADO'];
const AI_BLOCKED_STATUSES = ['FECHADO'];

interface ExtractedPayload {
  normalizedPhone: string;
  rawPhone: string;
  content: string;
  messageId?: string;
  senderName?: string;
}

function extractPayload(payload: any): ExtractedPayload | null {
  // Apenas ReceivedCallback; ignora SentCallback, DeliveryCallback etc.
  if (payload.type && payload.type !== 'ReceivedCallback') return null;

  // Ignorar mensagens enviadas pelo proprio numero (evita loop infinito)
  if (payload.fromMe === true) return null;

  // Ignorar grupos
  if (payload.isGroup) return null;

  const rawPhoneStr: string = payload.phone || payload.from || '';
  if (!rawPhoneStr) return null;

  const content: string =
    payload.text?.message ||
    payload.body ||
    payload.message?.conversation ||
    payload.message?.extendedTextMessage?.text ||
    '';

  if (!content || typeof content !== 'string' || !content.trim()) return null;

  const rawPhone        = rawPhoneStr.replace(/\D/g, '');   // "5511999999999"
  const normalizedPhone = rawPhone.replace(/^55/, '');       // "11999999999"

  if (normalizedPhone.length < 10) return null;

  return {
    normalizedPhone,
    rawPhone,
    content: content.trim(),
    messageId: payload.messageId || payload.id,
    senderName: payload.senderName || payload.pushName || normalizedPhone,
  };
}

export async function processZapiWebhook(payload: any): Promise<void> {
  console.log('[WEBHOOK] Payload recebido:', JSON.stringify(payload).substring(0, 300));

  try {
    const extracted = extractPayload(payload);
    if (!extracted) {
      console.log('[WEBHOOK] Payload descartado (fromMe, grupo, tipo nao-inbound ou sem conteudo)');
      return;
    }

    const { normalizedPhone, rawPhone, content, messageId, senderName } = extracted;
    console.log(`[WEBHOOK] Mensagem inbound | de: ${normalizedPhone} | "${content.substring(0, 80)}"`);

    // 1. Contato
    let contact = await prisma.contact.findUnique({ where: { phone: normalizedPhone } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: { name: senderName!, phone: normalizedPhone },
      });
      console.log(`[WEBHOOK] Novo contato criado | id: ${contact.id} | nome: ${senderName}`);
    } else if (contact.name !== senderName && senderName !== normalizedPhone) {
      await prisma.contact.update({ where: { id: contact.id }, data: { name: senderName } });
    }

    // 2. Loja e atendente padrao
    const defaultStore = await prisma.store.findFirst({ where: { active: true } });
    const defaultUser  = defaultStore
      ? await prisma.user.findFirst({
          where: { storeId: defaultStore.id, role: { in: ['VENDEDOR', 'ATENDENTE'] }, active: true },
        })
      : null;

    // 3. Lead
    let lead       = await prisma.lead.findFirst({ where: { phone: normalizedPhone } });
    const isNewLead = !lead;

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          name:           senderName!,
          phone:          normalizedPhone,
          source:         'WhatsApp',
          contactId:      contact.id,
          storeId:        defaultStore?.id,
          assignedUserId: defaultUser?.id,
        },
      });
      console.log(`[WEBHOOK] Novo lead criado | id: ${lead.id}`);
    }

    // 4. Conversa
    let conversation = await prisma.conversation.findFirst({
      where:   { contactId: contact.id, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });

    const isNewConversation = !conversation;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          contactId:      contact.id,
          leadId:         lead.id,
          storeId:        defaultStore?.id,
          assignedUserId: defaultUser?.id,
          status:         'NOVO',
          aiEnabled:      false,
          mode:           'HUMANO',
          lastMessageAt:  new Date(),
        },
      });
      console.log(`[WEBHOOK] Nova conversa criada | id: ${conversation.id} | atendente: ${defaultUser?.id ?? 'nenhum'}`);
    } else if (conversation.status === 'AGUARDANDO_CLIENTE') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data:  { status: 'EM_ATENDIMENTO' },
      });
      console.log(`[WEBHOOK] Conversa reaberta | id: ${conversation.id}`);
    }

    // 5. Salvar mensagem INBOUND
    const message = await prisma.message.create({
      data: {
        conversationId:    conversation.id,
        direction:         'INBOUND',
        type:              'TEXT',
        content,
        providerMessageId: messageId,
        senderType:        'CLIENT',
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
    });

    console.log(`[WEBHOOK] Mensagem salva | msg: ${message.id} | conversa: ${conversation.id}`);

    // 6. Socket.IO — emitir IMEDIATAMENTE apos salvar, antes de qualquer pipeline lenta
    const msgPayload = {
      id:             message.id,
      conversationId: conversation.id,
      direction:      message.direction,
      type:           message.type,
      content:        message.content,
      senderType:     'CLIENT',
      createdAt:      message.createdAt.toISOString(),
    };

    emitNewMessage(conversation.id, msgPayload);

    if (isNewConversation) {
      emitNewConversation({ conversationId: conversation.id, contact, lead });
      console.log(`[INBOX] Nova conversa emitida via socket | id: ${conversation.id}`);
    } else {
      emitConversationUpdate(conversation.id, {
        lastMessageAt: new Date(),
        unreadCount:   (conversation.unreadCount ?? 0) + 1,
      });
      console.log(`[INBOX] Conversa atualizada via socket | id: ${conversation.id}`);
    }

    // 7. Classificacao de intencao (local, nunca falha)
    const classification = await classifyIntentAndTemperature(content);
    const prevTemperature = lead.temperature;
    await prisma.lead.update({
      where: { id: lead.id },
      data:  {
        temperature: classification.temperature,
        score:       Math.max(lead.score, classification.score),
      },
    });

    // Trigger LEAD_HOT quando temperatura escala para QUENTE ou URGENTE
    if (
      (classification.temperature === 'QUENTE' || classification.temperature === 'URGENTE') &&
      prevTemperature !== classification.temperature
    ) {
      console.log(`[WEBHOOK] Lead quente detectado | lead: ${lead.id} | temp: ${classification.temperature}`);
      await triggerFlowsByEvent('LEAD_HOT', classification.temperature, conversation.id, lead.id);
    }

    // 8. Log de automacao
    await prisma.automationLog.create({
      data: {
        type:           'WEBHOOK_RECEIVED',
        description:    `Mensagem recebida de ${normalizedPhone}`,
        data:           JSON.stringify({ classification }),
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    });

    // 9. Gatilhos de fluxo
    await triggerFlowsByEvent('KEYWORD', content, conversation.id, lead.id);
    if (isNewLead) {
      await triggerFlowsByEvent('FIRST_MESSAGE', content, conversation.id, lead.id);
      await triggerFlowsByEvent('LEAD_CREATED',  content, conversation.id, lead.id);
    }

    // 10. Verificar se IA deve responder
    const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });

    if (!freshConv?.aiEnabled) {
      console.log('[IA] IA desabilitada nesta conversa — atendimento manual ativo');
      return;
    }
    if (AI_BLOCKED_MODES.includes(freshConv.mode)) {
      console.log(`[IA] Modo "${freshConv.mode}" bloqueia resposta automatica`);
      return;
    }
    if (AI_BLOCKED_STATUSES.includes(freshConv.status)) {
      console.log(`[IA] Status "${freshConv.status}" bloqueia resposta automatica`);
      return;
    }

    console.log(`[IA] Chamando IA | conversa: ${conversation.id} | modo: ${freshConv.mode}`);

    // 11. Montar historico e chamar IA
    const recentMessages = await prisma.message.findMany({
      where:   { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take:    20,
    });

    const chatHistory = recentMessages.map((m) => ({
      role:    (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

    let aiReply: string;
    try {
      aiReply = await generateAiResponse(conversation.id, chatHistory, conversation.storeId);
    } catch (aiErr: any) {
      console.error('[IA] Erro ao chamar IA:', aiErr.message);
      return;
    }

    if (!aiReply) {
      console.warn('[IA] IA retornou resposta vazia — pulando envio');
      return;
    }

    console.log(`[IA] Resposta gerada: "${aiReply.substring(0, 100)}"`);

    // 12. Salvar mensagem OUTBOUND da IA
    const aiMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction:      'OUTBOUND',
        type:           'TEXT',
        content:        aiReply,
        senderType:     'AI',
      },
    });

    // 13. Enviar via Z-API usando rawPhone (com DDI "55")
    try {
      await sendTextMessage(rawPhone, aiReply, conversation.storeId);
      console.log(`[ZAPI] Mensagem IA enviada para ${rawPhone}`);
    } catch (zapErr: any) {
      console.error(`[ZAPI] Falha ao enviar para ${rawPhone}:`, zapErr.message);
    }

    // 14. Emitir resposta da IA em tempo real
    emitNewMessage(conversation.id, {
      id:             aiMessage.id,
      conversationId: conversation.id,
      direction:      'OUTBOUND',
      type:           'TEXT',
      content:        aiReply,
      senderType:     'AI',
      createdAt:      aiMessage.createdAt.toISOString(),
    });

    await prisma.automationLog.create({
      data: {
        type:           'AI_RESPONSE',
        description:    `IA respondeu na conversa ${conversation.id}`,
        data:           null,
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    });

    console.log(`[IA] Fluxo completo | conversa: ${conversation.id} | msg outbound: ${aiMessage.id}`);

  } catch (err: any) {
    console.error('[WEBHOOK] Erro no processamento:', err.message, '\n', err.stack);
    throw err;
  }
}
