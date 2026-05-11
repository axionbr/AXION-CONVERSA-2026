import { PrismaClient } from '@prisma/client';
import { classifyIntentAndTemperature, generateAiResponse } from './aiService';
import { sendTextMessage } from './zapiService';
import { emitNewMessage, emitConversationUpdate, emitNewConversation } from '../socket';
import { triggerFlowsByEvent } from './flowEngine';
import { initiateHandoff, checkExpiredNotifications } from './handoffService';

const prisma = new PrismaClient();

// ─── Status e modos que bloqueiam IA ──────────────────────────────────────────
const OPEN_STATUSES       = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];
const AI_BLOCKED_MODES    = ['HUMANO', 'PAUSADO', 'AGUARDANDO_HUMANO'];
const AI_BLOCKED_STATUSES = ['FECHADO'];

// ─── Prefixos de log padronizados ─────────────────────────────────────────────
const L = {
  RCV:  '[WEBHOOK_RECEIVED]',
  DUP:  '[MESSAGE_DUPLICATED_IGNORED]',
  IN:   '[MESSAGE_INBOUND_SAVED]',
  OUT:  '[MESSAGE_OUTBOUND_DETECTED]',
  ERR:  '[WEBHOOK_ERROR]',
  AI:   '[IA]',
  ZAPI: '[ZAPI]',
  FLOW: '[FLOW]',
  CONV: '[CONVERSA]',
  LEAD: '[LEAD]',
  CONT: '[CONTATO]',
};

// ─── Tipos de callback Z-API que NÃO são mensagens inbound ───────────────────
const NON_INBOUND_TYPES = [
  'SentCallback', 'DeliveryCallback', 'ReadCallback',
  'MessageStatusCallback', 'PresenceCallback', 'ConnectedCallback',
  'DisconnectedCallback', 'AllUnreadCountCallback', 'StatusCallback',
];

interface ExtractedPayload {
  normalizedPhone: string;
  rawPhone:        string;
  content:         string;
  messageId?:      string;
  senderName:      string; // sempre preenchido com fallback = normalizedPhone
}

// ─── Extrai campos relevantes do payload Z-API ────────────────────────────────
function extractPayload(payload: any): ExtractedPayload | null {
  if (!payload || typeof payload !== 'object') return null;

  // Callbacks que não são mensagens recebidas
  if (NON_INBOUND_TYPES.includes(payload.type)) {
    console.log(`${L.OUT} | type: ${payload.type} | ignorado`);
    return null;
  }

  // ReceivedCallback é o tipo explícito de mensagem inbound
  if (payload.type && payload.type !== 'ReceivedCallback') {
    console.log(`${L.OUT} | type: ${payload.type} (desconhecido) | ignorado`);
    return null;
  }

  // fromMe = mensagem enviada pelo próprio número (evita loop)
  if (payload.fromMe === true) {
    console.log(`${L.OUT} | fromMe: true | ignorado para evitar loop`);
    return null;
  }

  // Ignorar grupos
  if (payload.isGroup === true) {
    console.log(`${L.OUT} | grupo | ignorado`);
    return null;
  }

  const rawPhoneStr: string = payload.phone || payload.from || '';
  if (!rawPhoneStr) {
    console.log(`${L.OUT} | sem telefone | ignorado`);
    return null;
  }

  // Extrai conteúdo — tenta todas as variações conhecidas do payload Z-API
  const content: string = (
    payload.text?.message              ||
    payload.body                       ||
    payload.message?.conversation      ||
    payload.message?.extendedTextMessage?.text ||
    payload.caption                    ||
    ''
  );

  if (!content || typeof content !== 'string' || !content.trim()) {
    // Mídia sem legenda (imagem, áudio, vídeo) — ignorar silenciosamente por enquanto
    console.log(`${L.OUT} | sem conteúdo de texto | type: ${payload.type || 'N/A'} | ignorado`);
    return null;
  }

  const rawPhone        = rawPhoneStr.replace(/\D/g, '');  // "5511999999999"
  const normalizedPhone = rawPhone.replace(/^55/, '');      // "11999999999"

  if (normalizedPhone.length < 10) {
    console.log(`${L.OUT} | telefone inválido: ${normalizedPhone} | ignorado`);
    return null;
  }

  const messageId  = (payload.messageId || payload.id || '').toString().trim() || undefined;
  const senderName = (payload.senderName || payload.pushName || normalizedPhone) as string;

  return { normalizedPhone, rawPhone, content: content.trim(), messageId, senderName };
}

// ─── Processador principal do webhook ────────────────────────────────────────
export async function processZapiWebhook(payload: any): Promise<void> {
  // Log compacto: apenas primeiros 300 chars para não poluir log de produção
  console.log(`${L.RCV} | ${JSON.stringify(payload).substring(0, 300)}`);

  // Verificar notificações de vendedor expiradas (robusto contra restart de processo)
  checkExpiredNotifications().catch(() => {});

  try {
    const extracted = extractPayload(payload);
    if (!extracted) return; // razão já logada dentro de extractPayload

    const { normalizedPhone, rawPhone, content, messageId, senderName } = extracted;

    console.log(`${L.RCV} | de: ${normalizedPhone} | msgId: ${messageId ?? 'sem-id'} | "${content.substring(0, 80)}"`);

    // ── PASSO 1 — Deduplicação primária (por messageId, antes de criar registros) ──
    if (messageId) {
      const dup = await prisma.message.findFirst({
        where:  { providerMessageId: messageId, direction: 'INBOUND' },
        select: { id: true },
      });
      if (dup) {
        console.log(`${L.DUP} | msgId: ${messageId} | phone: ${normalizedPhone} | já existe: ${dup.id}`);
        return;
      }
    }

    // ── PASSO 2 — Contato ─────────────────────────────────────────────────────
    let contact = await prisma.contact.findUnique({ where: { phone: normalizedPhone } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: { name: senderName, phone: normalizedPhone },
      });
      console.log(`${L.CONT} | novo | id: ${contact.id} | nome: ${senderName}`);
    } else if (contact.name !== senderName && senderName !== normalizedPhone) {
      await prisma.contact.update({ where: { id: contact.id }, data: { name: senderName } });
      console.log(`${L.CONT} | nome atualizado | id: ${contact.id} | ${contact.name} → ${senderName}`);
    }

    // ── PASSO 3 — Deduplicação fallback (sem messageId: janela 2 min + conteúdo) ──
    if (!messageId) {
      const twoMinAgo = new Date(Date.now() - 120_000);
      const dup = await prisma.message.findFirst({
        where: {
          direction: 'INBOUND',
          content,
          createdAt: { gte: twoMinAgo },
          conversation: { contactId: contact.id },
        },
        select: { id: true },
      });
      if (dup) {
        console.log(`${L.DUP} | fallback conteúdo | phone: ${normalizedPhone} | "${content.substring(0, 60)}"`);
        return;
      }
    }

    // ── PASSO 4 — Loja e atendente padrão ─────────────────────────────────────
    const defaultStore = await prisma.store.findFirst({ where: { active: true } });
    const defaultUser  = defaultStore
      ? await prisma.user.findFirst({
          where:   { storeId: defaultStore.id, role: { in: ['VENDEDOR', 'ATENDENTE'] }, active: true },
          orderBy: { createdAt: 'asc' }, // mais antigo = mais provavelmente responsável
        })
      : null;

    // ── PASSO 5 — Lead ────────────────────────────────────────────────────────
    let lead       = await prisma.lead.findFirst({ where: { phone: normalizedPhone } });
    const isNewLead = !lead;

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          name:           senderName,
          phone:          normalizedPhone,
          source:         'WhatsApp',
          contactId:      contact.id,
          storeId:        defaultStore?.id,
          assignedUserId: defaultUser?.id,
        },
      });
      console.log(`${L.LEAD} | novo | id: ${lead.id} | atendente: ${defaultUser?.id ?? 'nenhum'}`);
    }

    // ── PASSO 6 — Conversa ────────────────────────────────────────────────────
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
          aiEnabled:      true,          // IA ativa por padrão — responde automaticamente
          mode:           'IA_AUTOMATICA',
          lastMessageAt:  new Date(),
        },
      });
      console.log(`${L.CONV} | nova | id: ${conversation.id} | atendente: ${defaultUser?.id ?? 'nenhum'}`);
    } else if (conversation.status === 'AGUARDANDO_CLIENTE') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data:  { status: 'EM_ATENDIMENTO' },
      });
      console.log(`${L.CONV} | reaberta (voltou de AGUARDANDO_CLIENTE) | id: ${conversation.id}`);
    }

    // ── PASSO 7 — Salvar mensagem INBOUND ─────────────────────────────────────
    const message = await prisma.message.create({
      data: {
        conversationId:    conversation.id,
        direction:         'INBOUND',
        type:              'TEXT',
        content,
        providerMessageId: messageId,   // chave de deduplicação
        senderType:        'CLIENT',
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
    });

    console.log(`${L.IN} | msg: ${message.id} | conv: ${conversation.id} | phone: ${normalizedPhone}`);

    // ── PASSO 8 — Socket.IO (emitir IMEDIATAMENTE antes de pipelines lentas) ──
    const msgPayload = {
      id:             message.id,
      conversationId: conversation.id,
      direction:      'INBOUND',
      type:           'TEXT',
      content,
      senderType:     'CLIENT',
      createdAt:      message.createdAt.toISOString(),
    };

    emitNewMessage(conversation.id, msgPayload);

    if (isNewConversation) {
      emitNewConversation({ conversationId: conversation.id, contact, lead });
      console.log(`${L.CONV} | emitida via socket | id: ${conversation.id}`);
    } else {
      emitConversationUpdate(conversation.id, {
        lastMessageAt: new Date().toISOString(),
        unreadCount:   (conversation.unreadCount ?? 0) + 1,
      });
    }

    // ── PASSO 9 — Classificação de intenção (local, nunca falha) ──────────────
    const classification = await classifyIntentAndTemperature(content);
    const prevTemperature = lead.temperature;

    await prisma.lead.update({
      where: { id: lead.id },
      data:  {
        temperature: classification.temperature,
        score:       Math.max(lead.score, classification.score),
      },
    });

    // ── PASSO 10 — Trigger LEAD_HOT + handoff se temperatura escalou ─────────
    if (
      (classification.temperature === 'QUENTE' || classification.temperature === 'URGENTE') &&
      prevTemperature !== classification.temperature
    ) {
      console.log(`${L.LEAD} | QUENTE detectado | lead: ${lead.id} | temp: ${classification.temperature}`);

      // Trigger de fluxo
      triggerFlowsByEvent('LEAD_HOT', classification.temperature, conversation.id, lead.id)
        .catch((e: any) => console.error(`${L.FLOW} | LEAD_HOT error:`, e.message));

      // Iniciar handoff IA → vendedor (fire-and-forget, não bloqueia pipeline)
      initiateHandoff(
        conversation.id,
        {
          id:          lead.id,
          phone:       normalizedPhone,
          temperature: classification.temperature,
          storeId:     conversation.storeId,
          region:      lead.region,
        },
      ).catch((e: any) => console.error('[HANDOFF] initiateHandoff error:', e.message));
    }

    // ── PASSO 11 — Log de automação ────────────────────────────────────────────
    await prisma.automationLog.create({
      data: {
        type:           'WEBHOOK_RECEIVED',
        description:    `Mensagem recebida de ${normalizedPhone}`,
        data:           JSON.stringify({ classification, msgId: messageId }),
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    });

    // ── PASSO 12 — Gatilhos de fluxo ──────────────────────────────────────────
    triggerFlowsByEvent('KEYWORD', content, conversation.id, lead.id)
      .catch((e: any) => console.error(`${L.FLOW} | KEYWORD error:`, e.message));

    if (isNewLead) {
      triggerFlowsByEvent('FIRST_MESSAGE', content, conversation.id, lead.id)
        .catch((e: any) => console.error(`${L.FLOW} | FIRST_MESSAGE error:`, e.message));
      triggerFlowsByEvent('LEAD_CREATED', content, conversation.id, lead.id)
        .catch((e: any) => console.error(`${L.FLOW} | LEAD_CREATED error:`, e.message));
    }

    // ── PASSO 13 — Verificar se IA deve responder ─────────────────────────────

    // Guarda-chuva: se esta mensagem acabou de elevar a temperatura para QUENTE/URGENTE,
    // o handoff foi disparado (fire-and-forget). Bloquear aqui antes de chamar a IA para
    // evitar race condition — sem depender do timing da atualização assíncrona do banco.
    const tempJustBecameHot =
      (classification.temperature === 'QUENTE' || classification.temperature === 'URGENTE') &&
      prevTemperature !== classification.temperature;

    if (tempJustBecameHot) {
      console.log(`${L.AI} | ignorada — handoff iniciado para lead ${classification.temperature} | conv: ${conversation.id}`);
      return;
    }

    const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });

    if (!freshConv?.aiEnabled) {
      console.log(`${L.AI} | desabilitada | conv: ${conversation.id}`);
      return;
    }
    if (AI_BLOCKED_MODES.includes(freshConv.mode)) {
      console.log(`${L.AI} | ignorada | modo "${freshConv.mode}" | conv: ${conversation.id}`);
      return;
    }
    if (AI_BLOCKED_STATUSES.includes(freshConv.status)) {
      console.log(`${L.AI} | ignorada | status "${freshConv.status}" | conv: ${conversation.id}`);
      return;
    }

    console.log(`${L.AI} | chamando | conv: ${conversation.id} | modo: ${freshConv.mode}`);

    // ── PASSO 14 — Montar histórico e chamar IA ───────────────────────────────
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
      console.error(`${L.AI} | erro ao chamar IA:`, aiErr.message);
      await prisma.automationLog.create({
        data: {
          type:           'AI_ERROR',
          description:    `Erro IA: ${aiErr.message}`,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      return;
    }

    if (!aiReply || !aiReply.trim()) {
      console.warn(`${L.AI} | resposta vazia — pulando envio`);
      return;
    }

    console.log(`${L.AI} | resposta gerada: "${aiReply.substring(0, 100)}"`);

    // ── PASSO 15 — Salvar mensagem OUTBOUND da IA ─────────────────────────────
    const aiMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction:      'OUTBOUND',
        type:           'TEXT',
        content:        aiReply,
        senderType:     'AI',
      },
    });

    // ── PASSO 16 — Enviar via Z-API (usa rawPhone com DDI "55") ───────────────
    try {
      await sendTextMessage(rawPhone, aiReply, conversation.storeId);
      console.log(`${L.ZAPI} | IA enviada | para: ${rawPhone} | conv: ${conversation.id}`);
    } catch (zapErr: any) {
      console.error(`${L.ZAPI} | falha ao enviar | para: ${rawPhone} |`, zapErr.message);
      // Não bloqueia — mensagem já foi salva no banco
    }

    // ── PASSO 17 — Emitir resposta da IA em tempo real ────────────────────────
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
        description:    `IA respondeu | conv: ${conversation.id}`,
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    });

    console.log(`${L.AI} | fluxo completo | conv: ${conversation.id} | outbound: ${aiMessage.id}`);

  } catch (err: any) {
    console.error(`${L.ERR} | ${err.message}`, '\n', err.stack);
    throw err;
  }
}
