import { PrismaClient } from '@prisma/client';
import { classifyIntentAndTemperature, generateAiResponse, analyzeConversation, determineAgentStage, LeadContext, AgentType } from './aiService';
import { sendTextMessage } from './zapiService';
import { emitNewMessage, emitConversationUpdate, emitNewConversation } from '../socket';
import { triggerFlowsByEvent, continueExecutionWithResponse, CONVERSATIONAL_EVENTS } from './flowEngine';
import { initiateHandoff, checkExpiredNotifications } from './handoffService';

const prisma = new PrismaClient();

// ─── Status e modos que bloqueiam IA ──────────────────────────────────────────
const OPEN_STATUSES       = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];
const AI_BLOCKED_MODES    = ['HUMANO', 'PAUSADO', 'AGUARDANDO_HUMANO'];
const AI_BLOCKED_STATUSES = ['FECHADO'];

// ─── Prefixos de log padronizados ─────────────────────────────────────────────
const L = {
  // Webhook
  RCV:     '[WEBHOOK_RECEIVED]',
  DUP:     '[MESSAGE_DUPLICATED_IGNORED]',
  IN:      '[MESSAGE_INBOUND_SAVED]',
  OUT:     '[MESSAGE_OUTBOUND_DETECTED]',
  ERR:     '[WEBHOOK_ERROR]',
  // Entidades
  CONT:    '[CONTATO]',
  LEAD:    '[LEAD]',
  CONV:    '[CONVERSA]',
  // IA
  AI:      '[IA_PROCESSING_STARTED]',
  AI_CTX:  '[IA_CONTEXT_BUILT]',
  AI_ON:   '[IA_AUTO_ENABLED_ON_NEW_CONVERSATION]',
  AI_GEN:  '[IA_RESPONSE_GENERATED]',
  AI_SND:  '[IA_RESPONSE_SENT]',
  AI_SKP:  '[IA_SKIPPED_REASON]',
  AI_ERR:  '[IA_ERROR]',
  // Lead
  TEMP:    '[LEAD_TEMPERATURE_UPDATED]',
  HOT:     '[LEAD_HOT_DETECTED]',
  QUAL:    '[LEAD_QUALIFIED]',
  // Handoff
  HOFF:    '[HANDOFF_STARTED]',
  SELL:    '[SELLER_NOTIFIED]',
  // Demais
  ZAPI:    '[ZAPI]',
  FLOW:    '[FLOW_EVENT_TRIGGERED]',
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

  // ── Localização compartilhada pelo cliente via WhatsApp ──────────────────────
  // Z-API envia: { location: { latitude, longitude, name, address } }
  if (payload.location && (payload.location.latitude || payload.location.longitude)) {
    const loc      = payload.location;
    const locName  = loc.name || loc.address || `${loc.latitude},${loc.longitude}`;
    const locText  = `📍 Localização: ${locName}`;

    const rawPhone        = rawPhoneStr.replace(/\D/g, '');
    const normalizedPhone = rawPhone.replace(/^55/, '');

    if (normalizedPhone.length < 10) {
      console.log(`${L.OUT} | localização | telefone inválido | ignorado`);
      return null;
    }

    return {
      normalizedPhone,
      rawPhone,
      content: locText,
      messageId:  payload.messageId || payload.id,
      senderName: payload.senderName || payload.pushName || normalizedPhone,
      // campo extra para identificar como localização e atualizar lead.region
      ...(loc.name || loc.address ? { _locationRegion: loc.name || loc.address } : {}),
    } as any;
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
    const locationRegion: string | undefined = (extracted as any)._locationRegion;

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
      // ── 6a. Conversa nova ─────────────────────────────────────────────────
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
      console.log(`${L.AI_ON} | conv: ${conversation.id} | modo: IA_AUTOMATICA`);

    } else {
      // ── 6b. Conversa existente — verificar se IA precisa ser (re)ativada ──

      // Vendedor ativo = alguém assumiu e está em EM_ATENDIMENTO modo HUMANO
      const vendorActive  = conversation.mode === 'HUMANO' && conversation.status === 'EM_ATENDIMENTO';
      // Handoff pendente = aguardando vendedor aceitar
      const pendingHandoff = conversation.mode === 'AGUARDANDO_HUMANO';

      if (conversation.status === 'AGUARDANDO_CLIENTE') {
        if (!vendorActive && !pendingHandoff) {
          // Cliente respondeu sem vendedor ativo → reativar IA automática
          await prisma.conversation.update({
            where: { id: conversation.id },
            data:  { status: 'EM_ATENDIMENTO', aiEnabled: true, mode: 'IA_AUTOMATICA' },
          });
          emitConversationUpdate(conversation.id, { mode: 'IA_AUTOMATICA', aiEnabled: true, status: 'EM_ATENDIMENTO' });
          console.log(`[CONVERSATION_REOPENED_WITH_AI] | conv: ${conversation.id} | AGUARDANDO_CLIENTE → IA_AUTOMATICA`);
          console.log(`${L.AI_ON} | conv: ${conversation.id}`);
        } else {
          // Vendedor ativo → apenas reabrir status, manter modo humano
          await prisma.conversation.update({
            where: { id: conversation.id },
            data:  { status: 'EM_ATENDIMENTO' },
          });
          console.log(`${L.CONV} | reaberta c/ vendedor ativo | id: ${conversation.id}`);
        }

      } else if (!pendingHandoff && !vendorActive && !conversation.aiEnabled) {
        // Conversa antiga em modo HUMANO (pré-correção ou manual) sem vendedor ativo
        // → reativar IA automática para este novo atendimento
        await prisma.conversation.update({
          where: { id: conversation.id },
          data:  { aiEnabled: true, mode: 'IA_AUTOMATICA' },
        });
        emitConversationUpdate(conversation.id, { mode: 'IA_AUTOMATICA', aiEnabled: true });
        console.log(`[CONVERSATION_REOPENED_WITH_AI] | conv: ${conversation.id} | HUMANO → IA_AUTOMATICA`);
        console.log(`${L.AI_ON} | conv: ${conversation.id}`);
      }
      // Casos onde NÃO alteramos:
      //   pendingHandoff (AGUARDANDO_HUMANO) — aguardando vendedor
      //   vendorActive   (EM_ATENDIMENTO + HUMANO) — vendedor está atendendo
      //   aiEnabled já true — IA já ativa
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

    // ── PASSO 8.5 — Geolocalização: se payload tinha location, atualiza lead.region ──
    if (locationRegion && !lead.region) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { region: locationRegion },
      }).catch(() => {});
      console.log(`[GEO_LOCATION] | lead: ${lead.id} | região atualizada: ${locationRegion}`);
    }

    // ── PASSO 9 — Classificação de intenção (local, nunca falha) ──────────────
    const classification = await classifyIntentAndTemperature(content);
    const prevTemperature = lead.temperature;

    const tempEscalated =
      (classification.temperature === 'QUENTE' || classification.temperature === 'URGENTE') &&
      prevTemperature !== classification.temperature;

    await prisma.lead.update({
      where: { id: lead.id },
      data:  {
        temperature: classification.temperature,
        score:       Math.max(lead.score, classification.score),
      },
    });

    // Log de atualização de temperatura quando muda
    if (prevTemperature !== classification.temperature) {
      console.log(`${L.TEMP} | lead: ${lead.id} | ${prevTemperature} → ${classification.temperature}`);
      await prisma.automationLog.create({
        data: {
          type:           'LEAD_TEMPERATURE_UPDATED',
          description:    `Temperatura: ${prevTemperature} → ${classification.temperature}`,
          data:           JSON.stringify({ prev: prevTemperature, current: classification.temperature }),
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});

      // Disparar evento TEMPERATURE_CHANGED nos fluxos
      triggerFlowsByEvent('TEMPERATURE_CHANGED', classification.temperature, conversation.id, lead.id)
        .catch((e: any) => console.error(`[FLOW] TEMPERATURE_CHANGED error:`, e.message));
    }

    // ── PASSO 10 — Trigger LEAD_HOT + handoff se temperatura escalou ─────────
    if (tempEscalated) {
      console.log(`${L.HOT} | lead: ${lead.id} | temp: ${prevTemperature} → ${classification.temperature} | conv: ${conversation.id}`);

      // Log LEAD_HOT_DETECTED no banco
      await prisma.automationLog.create({
        data: {
          type:           'LEAD_HOT_DETECTED',
          description:    `Lead ${classification.temperature}: acionando handoff | conv: ${conversation.id}`,
          data:           JSON.stringify({ temperature: classification.temperature, intent: classification.intent }),
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});

      // Trigger de fluxo
      triggerFlowsByEvent('LEAD_HOT', classification.temperature, conversation.id, lead.id)
        .catch((e: any) => console.error(`[FLOW] LEAD_HOT error:`, e.message));

      console.log(`${L.HOFF} | conv: ${conversation.id} | iniciando handoff IA → vendedor`);

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

    // ── PASSO 12 — VERIFICAÇÃO DE PRIORIDADE DE FLUXO ────────────────────────
    // Ordem: 1) continuar fluxo aguardando resposta  2) novo trigger  3) IA fallback

    // ── 12a. Continuar FlowExecution aguardando resposta do cliente ───────────
    const waitingExecution = await prisma.flowExecution.findFirst({
      where: { conversationId: conversation.id, status: 'WAITING_RESPONSE' },
      orderBy: { startedAt: 'desc' },
    });

    if (waitingExecution) {
      console.log(`[FLOW_CONTINUE] | execution: ${waitingExecution.id} | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'FLOW_CONTINUED',
          description:    `Fluxo continuado com resposta do cliente (execução: ${waitingExecution.id})`,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      await continueExecutionWithResponse(waitingExecution.id, content);
      return; // Fluxo gerencia o atendimento — IA não deve responder
    }

    console.log(`[FLOW_PRIORITY_CHECK] | conv: ${conversation.id} | lead: ${lead.id}`);
    await prisma.automationLog.create({
      data: {
        type:           'FLOW_PRIORITY_CHECK',
        description:    `Verificando fluxos ativos para mensagem recebida`,
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    }).catch(() => {});

    let conversationalFlowExecuted = false;

    // — Eventos conversacionais: aguardados, resultado decide se IA roda ———————
    const convId  = conversation.id;
    const leadId_ = lead.id;

    // Macro local: executa fluxo conversacional e salva FLOW_MATCHED no banco se executou
    const checkFlow = async (eventType: string, val: string): Promise<boolean> => {
      const executed = await triggerFlowsByEvent(eventType, val, convId, leadId_)
        .catch((e: any) => { console.error(`[FLOW] ${eventType} error:`, e.message); return false; });
      if (executed) {
        console.log(`[FLOW_MATCHED] | ${eventType} | conv: ${convId}`);
        prisma.automationLog.create({
          data: {
            type:           'FLOW_MATCHED',
            description:    `Fluxo conversacional "${eventType}" correspondeu — será executado`,
            data:           JSON.stringify({ eventType }),
            conversationId: convId,
            leadId:         leadId_,
          },
        }).catch(() => {});
      }
      return executed;
    };

    if (await checkFlow('MESSAGE_RECEIVED', content)) conversationalFlowExecuted = true;
    if (await checkFlow('KEYWORD',          content)) conversationalFlowExecuted = true;

    if (isNewLead) {
      if (await checkFlow('FIRST_MESSAGE', content)) conversationalFlowExecuted = true;

      // LEAD_CREATED é evento de efeito colateral — fire-and-forget, não bloqueia IA
      triggerFlowsByEvent('LEAD_CREATED', content, convId, leadId_)
        .catch((e: any) => console.error(`[FLOW] LEAD_CREATED error:`, e.message));
    }

    if (isNewConversation) {
      // CONVERSATION_CREATED é evento de efeito colateral — fire-and-forget
      triggerFlowsByEvent('CONVERSATION_CREATED', content, convId, leadId_)
        .catch((e: any) => console.error(`[FLOW] CONVERSATION_CREATED error:`, e.message));
    }

    // — Se fluxo conversacional executou → IA NÃO faz fallback ————————————————
    if (conversationalFlowExecuted) {
      console.log(`[AI_SKIPPED_FLOW_ACTIVE] | fluxo tratou a mensagem | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'AI_SKIPPED_FLOW_ACTIVE',
          description:    `IA não respondeu — fluxo conversacional com prioridade executou`,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      return; // Fluxo assumiu o atendimento
    }

    // — Nenhum fluxo conversacional ativo → IA age como fallback comercial ——————
    console.log(`[AI_FALLBACK_USED] | nenhum fluxo ativo — IA assume como fallback | conv: ${conversation.id}`);
    await prisma.automationLog.create({
      data: {
        type:           'AI_FALLBACK_USED',
        description:    `Nenhum fluxo conversacional ativo — IA comercial assume atendimento`,
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    }).catch(() => {});

    // ── PASSO 13 — Verificar se IA deve responder ─────────────────────────────

    // Guarda-chuva: se esta mensagem acabou de elevar a temperatura para QUENTE/URGENTE,
    // o handoff foi disparado. Bloquear aqui para evitar race condition.
    if (tempEscalated) {
      const skipReason = `handoff iniciado — lead ${classification.temperature}`;
      console.log(`${L.AI_SKP} | ${skipReason} | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'IA_SKIPPED_REASON',
          description:    skipReason,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      return;
    }

    const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });

    if (!freshConv?.aiEnabled) {
      const skipReason = 'aiEnabled=false';
      console.log(`${L.AI_SKP} | ${skipReason} | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'IA_SKIPPED_REASON',
          description:    skipReason,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      return;
    }
    if (AI_BLOCKED_MODES.includes(freshConv.mode)) {
      const skipReason = `modo bloqueado: ${freshConv.mode}`;
      console.log(`${L.AI_SKP} | ${skipReason} | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'IA_SKIPPED_REASON',
          description:    skipReason,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      return;
    }
    if (AI_BLOCKED_STATUSES.includes(freshConv.status)) {
      const skipReason = `status bloqueado: ${freshConv.status}`;
      console.log(`${L.AI_SKP} | ${skipReason} | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'IA_SKIPPED_REASON',
          description:    skipReason,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      return;
    }

    console.log(`${L.AI} | conv: ${conversation.id} | modo: ${freshConv.mode}`);
    await prisma.automationLog.create({
      data: {
        type:           'IA_PROCESSING_STARTED',
        description:    `IA iniciando resposta | modo: ${freshConv.mode} | temp: ${classification.temperature}`,
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    }).catch(() => {});

    // ── PASSO 14 — Montar histórico e contexto do lead para IA ───────────────
    const recentMessages = await prisma.message.findMany({
      where:   { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take:    20,
    });

    const chatHistory = recentMessages.map((m) => ({
      role:    (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    }));

    // Contexto do lead: dados já coletados para evitar perguntas repetidas
    const freshLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    const leadContext: LeadContext = {
      name:        freshLead?.name !== normalizedPhone ? freshLead?.name : undefined,
      region:      freshLead?.region   ?? undefined,
      interest:    freshLead?.interest ?? undefined,
      temperature: freshLead?.temperature ?? undefined,
    };

    // Determinar agente comercial ativo com base no perfil do lead e qtde de mensagens
    const inboundCount  = recentMessages.filter(m => m.direction === 'INBOUND').length;
    const agentType: AgentType = determineAgentStage(
      { region: freshLead?.region, interest: freshLead?.interest, temperature: freshLead?.temperature ?? 'FRIO' },
      inboundCount,
    );

    console.log(`${L.AI_CTX} | agente: ${agentType} | inbound: ${inboundCount} | region: ${freshLead?.region ?? 'n/a'} | interest: ${freshLead?.interest ?? 'n/a'} | conv: ${conversation.id}`);
    await prisma.automationLog.create({
      data: {
        type:           'IA_CONTEXT_BUILT',
        description:    `Agente: ${agentType} | ${chatHistory.length} msgs | region: ${freshLead?.region ?? 'não coletada'}`,
        data:           JSON.stringify({ agentType, leadContext, messageCount: chatHistory.length, inboundCount }),
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    }).catch(() => {});

    // Logar mudança de agente para o frontend mostrar
    await prisma.automationLog.create({
      data: {
        type:           'IA_AGENT_STAGE',
        description:    `Agente comercial ativo: ${agentType}`,
        data:           JSON.stringify({ agentType, inboundCount, region: freshLead?.region, interest: freshLead?.interest }),
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    }).catch(() => {});

    let aiReply: string;
    try {
      aiReply = await generateAiResponse(conversation.id, chatHistory, conversation.storeId, leadContext, agentType);
    } catch (aiErr: any) {
      console.error(`${L.AI_ERR} | ${aiErr.message} | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'IA_ERROR',
          description:    `Erro ao gerar resposta: ${aiErr.message}`,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
      return;
    }

    if (!aiReply || !aiReply.trim()) {
      console.warn(`${L.AI_SKP} | resposta vazia | conv: ${conversation.id}`);
      return;
    }

    console.log(`${L.AI_GEN} | conv: ${conversation.id} | "${aiReply.substring(0, 100)}"`);
    await prisma.automationLog.create({
      data: {
        type:           'IA_RESPONSE_GENERATED',
        description:    `IA gerou resposta (${aiReply.length} chars)`,
        conversationId: conversation.id,
        leadId:         lead.id,
      },
    }).catch(() => {});

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
    let zapiSent = false;
    try {
      await sendTextMessage(rawPhone, aiReply, conversation.storeId);
      zapiSent = true;
      console.log(`${L.AI_SND} | via Z-API | para: ${rawPhone} | conv: ${conversation.id}`);
      await prisma.automationLog.create({
        data: {
          type:           'IA_RESPONSE_SENT',
          description:    `Resposta enviada via Z-API | msg: ${aiMessage.id}`,
          conversationId: conversation.id,
          leadId:         lead.id,
        },
      }).catch(() => {});
    } catch (zapErr: any) {
      console.error(`[ZAPI] | falha ao enviar IA | para: ${rawPhone} |`, zapErr.message);
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

    // ── PASSO 18 — Extração assíncrona de dados do lead em background ─────────
    // inboundCount já calculado no PASSO 14. A cada 4 msgs ou nas primeiras 2, extrai dados.
    if (inboundCount > 0 && (inboundCount <= 2 || inboundCount % 4 === 0)) {
      extractAndSaveLeadData(conversation.id, conversation.storeId, lead.id, recentMessages)
        .catch((e: any) => console.error('[LEAD_EXTRACT_BG] Erro:', e.message));
    }

    console.log(`[IA] | fluxo completo | conv: ${conversation.id} | outbound: ${aiMessage.id} | Z-API: ${zapiSent}`);

  } catch (err: any) {
    console.error(`${L.ERR} | ${err.message}`, '\n', err.stack);
    throw err;
  }
}

// ─── Extração assíncrona de dados de qualificação do lead ────────────────────
// Chamada em background a cada N mensagens para manter CRM atualizado.
async function extractAndSaveLeadData(
  conversationId: string,
  storeId: string | null | undefined,
  leadId: string,
  messages: { direction: string; content: string; senderType: string }[],
): Promise<void> {
  try {
    const analysis = await analyzeConversation(messages, storeId);

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    const leadUpdate: Record<string, string> = {};

    // Nome: atualizar se ainda é o telefone ou se a IA identificou nome real
    if (
      analysis.nomeCliente &&
      analysis.nomeCliente.length > 2 &&
      (lead.name === lead.phone || !lead.name)
    ) {
      leadUpdate.name = analysis.nomeCliente;
    }

    // Região: preencher apenas se ainda vazia
    const regiaoExtraida = [analysis.cidade, analysis.bairro, analysis.regiao]
      .filter(Boolean)
      .join(' / ');
    if (regiaoExtraida && !lead.region) {
      leadUpdate.region = regiaoExtraida;
    }

    // Interesse no produto
    if (analysis.modeloInteresse && !lead.interest) {
      leadUpdate.interest = analysis.modeloInteresse;
    }

    if (Object.keys(leadUpdate).length > 0) {
      await prisma.lead.update({ where: { id: leadId }, data: leadUpdate });
      console.log(`${L.QUAL} | lead: ${leadId} | dados: ${JSON.stringify(leadUpdate)}`);
      await prisma.automationLog.create({
        data: {
          type:           'LEAD_QUALIFIED',
          description:    `Dados extraídos pela IA: ${JSON.stringify(leadUpdate)}`,
          data:           JSON.stringify({ extracted: leadUpdate, analysis }),
          conversationId,
          leadId,
        },
      }).catch(() => {});
    }

    // Salvar análise completa para o Inbox
    await prisma.automationLog.create({
      data: {
        type:           'AI_ANALYSIS',
        description:    `Análise automática | tipo: ${analysis.tipo} | temp: ${analysis.temperatura}`,
        data:           JSON.stringify(analysis),
        conversationId,
        leadId,
      },
    }).catch(() => {});

  } catch (e: any) {
    console.error('[LEAD_EXTRACT_BG]', e.message);
  }
}
