import { PrismaClient } from '@prisma/client';
import { sendTextMessage } from './zapiService';
import {
  emitConversationUpdate,
  emitNewMessage,
  emitToUser,
} from '../socket';

const prisma = new PrismaClient();

// Minutos antes de uma notificação expirar e escalar para o próximo vendedor
const TIMEOUT_MINUTES = 5;

// Mensagem enviada pelo número central ao cliente durante o handoff
export const HANDOFF_MSG =
  'Ótimo, já entendi o que você procura. Vou te passar agora para um especialista da ' +
  'nossa equipe que atende a sua região, assim ele consegue te orientar com as melhores opções ' +
  'e condições disponíveis.';

// ─── Extração de região do texto ─────────────────────────────────────────────

const REGION_KEYWORDS: [string, string][] = [
  // [regex/keyword, valor normalizado]
  ['são paulo',     'SP - São Paulo'],
  ['sorocaba',      'SP - Sorocaba'],
  ['campinas',      'SP - Campinas'],
  ['santo andré',   'SP - Santo André'],
  ['santos',        'SP - Santos'],
  ['ribeirão preto','SP - Ribeirão Preto'],
  ['rio de janeiro','RJ - Rio de Janeiro'],
  ['belo horizonte','MG - Belo Horizonte'],
  ['curitiba',      'PR - Curitiba'],
  ['florianópolis', 'SC - Florianópolis'],
  ['porto alegre',  'RS - Porto Alegre'],
  ['salvador',      'BA - Salvador'],
  ['recife',        'PE - Recife'],
  ['fortaleza',     'CE - Fortaleza'],
  ['manaus',        'AM - Manaus'],
  ['goiânia',       'GO - Goiânia'],
  ['brasília',      'DF - Brasília'],
];

export function extractRegion(text: string): string | null {
  const lower = text.toLowerCase();

  // Cidades/regiões por nome
  for (const [kw, norm] of REGION_KEYWORDS) {
    if (lower.includes(kw)) return norm;
  }

  // DDD (11-99)
  const ddd = text.match(/\b(1[1-9]|2[1-9]|3[1-4]|3[7-8]|4[1-9]|5[1-5]|6[1-9]|7[1-9]|8[1-9]|9[1-9])\b/);
  if (ddd) return `DDD ${ddd[1]}`;

  return null;
}

// ─── Encontra o melhor vendedor para a região ─────────────────────────────────

export async function findBestSeller(
  storeId: string | null,
  region: string | null,
  excludeIds: string[] = [],
): Promise<{ id: string; name: string } | null> {
  const base: any = {
    active: true,
    role:   { in: ['VENDEDOR', 'ATENDENTE', 'GERENTE'] },
    id:     { notIn: excludeIds.length ? excludeIds : ['__none__'] },
  };
  if (storeId) base.storeId = storeId;

  const sellers = await prisma.user.findMany({
    where:   base,
    select:  { id: true, name: true, region: true },
    orderBy: { createdAt: 'asc' },
  });

  // Tentativa 1: correspondência de região
  if (region) {
    const rLow = region.toLowerCase();
    const match = sellers.find(s =>
      s.region && (
        s.region.toLowerCase().includes(rLow) ||
        rLow.includes(s.region.toLowerCase())
      )
    );
    if (match) return { id: match.id, name: match.name };
  }

  // Tentativa 2: qualquer vendedor da loja / disponível
  return sellers.length ? { id: sellers[0].id, name: sellers[0].name } : null;
}

// ─── Cria notificação para vendedor + emite socket ────────────────────────────

async function createNotification(
  conversationId: string,
  leadId: string | null,
  userId: string,
  userName: string,
  region: string | null,
  summary: string | undefined,
  contact: { name: string; phone: string },
  leadTemp: string,
): Promise<string> {
  const expiresAt = new Date(Date.now() + TIMEOUT_MINUTES * 60_000);

  const notif = await prisma.sellerNotification.create({
    data: {
      conversationId,
      leadId:    leadId ?? undefined,
      userId,
      region,
      summary,
      expiresAt,
      status: 'PENDING',
    },
  });

  await prisma.automationLog.create({
    data: {
      type:           'SELLER_NOTIFIED',
      description:    `Vendedor ${userName} notificado para conv: ${conversationId}`,
      conversationId,
      leadId:         leadId ?? undefined,
      userId,
    },
  });

  console.log(`[SELLER_NOTIFIED] | vendedor: ${userName} | conv: ${conversationId} | expira: ${expiresAt.toISOString()}`);

  // Emite para a sala pessoal do vendedor
  emitToUser(userId, 'handoff:notification', {
    notificationId: notif.id,
    conversationId,
    leadId,
    region,
    summary,
    contact,
    leadTemperature: leadTemp,
    expiresAt: expiresAt.toISOString(),
  });

  // Agendar verificação de expiração (best-effort; re-verificado também no webhook)
  setTimeout(() => {
    checkExpiry(notif.id).catch(e =>
      console.error('[HANDOFF] Erro no checkExpiry:', e.message)
    );
  }, TIMEOUT_MINUTES * 60_000 + 5_000);

  return notif.id;
}

// ─── Inicia o processo de handoff ─────────────────────────────────────────────

export async function initiateHandoff(
  conversationId: string,
  lead: {
    id: string;
    phone: string;
    temperature: string;
    storeId?: string | null;
    region?: string | null;
  },
  aiSummary?: string,
): Promise<void> {
  // Evita handoff duplicado na mesma conversa
  const conv = await prisma.conversation.findUnique({
    where:   { id: conversationId },
    include: { contact: true },
  });
  if (!conv) return;

  if (conv.mode === 'AGUARDANDO_HUMANO' || conv.mode === 'HUMANO') {
    console.log(`[HANDOFF] Conv ${conversationId} já em modo ${conv.mode} — ignorado`);
    return;
  }

  const pending = await prisma.sellerNotification.findFirst({
    where: { conversationId, status: 'PENDING' },
  });
  if (pending) {
    console.log(`[HANDOFF] Notificação pendente já existe para conv: ${conversationId}`);
    return;
  }

  // 1. Transição da conversa → AGUARDANDO_HUMANO
  await prisma.conversation.update({
    where: { id: conversationId },
    data:  { mode: 'AGUARDANDO_HUMANO', aiEnabled: false, status: 'EM_ATENDIMENTO' },
  });

  emitConversationUpdate(conversationId, {
    mode:      'AGUARDANDO_HUMANO',
    aiEnabled: false,
    status:    'EM_ATENDIMENTO',
  });

  // Log obrigatório de início do handoff
  await prisma.automationLog.create({
    data: {
      type:           'HANDOFF_STARTED',
      description:    `Handoff iniciado | temperatura: ${lead.temperature} | região: ${lead.region ?? 'não informada'}`,
      data:           JSON.stringify({ leadId: lead.id, temperature: lead.temperature, storeId: lead.storeId }),
      conversationId,
      leadId:         lead.id,
    },
  }).catch(() => {});

  console.log(`[HANDOFF_STARTED] | conv: ${conversationId} | lead: ${lead.id} | temp: ${lead.temperature}`);

  // 2. Extrair região da conversa
  const msgs = await prisma.message.findMany({
    where:   { conversationId, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    take:    15,
    select:  { content: true },
  });
  const allText       = msgs.map(m => m.content).join(' ');
  const region        = lead.region || extractRegion(allText);

  // Persistir região extraída no Lead se ainda não estiver salva
  if (region && !lead.region) {
    await prisma.lead.update({ where: { id: lead.id }, data: { region } })
      .catch(() => {});
    console.log(`[HANDOFF] Região salva no lead | id: ${lead.id} | region: ${region}`);
  }

  // 3. Enviar mensagem de transferência ao cliente pelo número central
  const rawPhone = `55${conv.contact.phone}`;
  try {
    await sendTextMessage(rawPhone, HANDOFF_MSG, conv.storeId);
    const sysMsg = await prisma.message.create({
      data: {
        conversationId,
        direction:  'OUTBOUND',
        type:       'TEXT',
        content:    HANDOFF_MSG,
        senderType: 'AI',
      },
    });
    emitNewMessage(conversationId, {
      id:             sysMsg.id,
      conversationId,
      direction:      'OUTBOUND',
      type:           'TEXT',
      content:        HANDOFF_MSG,
      senderType:     'AI',
      createdAt:      sysMsg.createdAt.toISOString(),
    });
    console.log(`[HANDOFF] Mensagem de transferência enviada | conv: ${conversationId}`);
  } catch (e: any) {
    console.error('[HANDOFF] Falha ao enviar mensagem de transferência:', e.message);
  }

  // 4. Encontrar e notificar vendedor
  const seller = await findBestSeller(conv.storeId, region);

  if (!seller) {
    console.warn(`[HANDOFF] Sem vendedor disponível — fila geral | conv: ${conversationId}`);
    await prisma.automationLog.create({
      data: {
        type:           'SELLER_ESCALATED',
        description:    'Nenhum vendedor disponível — conversa na fila geral',
        conversationId,
        leadId:         lead.id,
      },
    });
    return;
  }

  await createNotification(
    conversationId,
    lead.id,
    seller.id,
    seller.name,
    region,
    aiSummary,
    { name: conv.contact.name, phone: conv.contact.phone },
    lead.temperature,
  );
}

// ─── Vendedor aceita o handoff ────────────────────────────────────────────────

export async function acceptHandoff(
  notificationId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const notif = await prisma.sellerNotification.findUnique({
    where:   { id: notificationId },
    include: { user: true },
  });

  if (!notif)                          return { ok: false, error: 'Notificação não encontrada' };
  if (notif.userId !== userId)         return { ok: false, error: 'Notificação não pertence a você' };
  if (notif.status === 'ACCEPTED')     return { ok: false, error: 'Já aceito' };
  if (notif.status === 'EXPIRED')      return { ok: false, error: 'Notificação expirada — conversa foi repassada' };
  if (new Date() > notif.expiresAt)    return { ok: false, error: 'Tempo esgotado' };

  const userName = notif.user.name;

  await prisma.$transaction(async (tx) => {
    await tx.sellerNotification.update({
      where: { id: notificationId },
      data:  { status: 'ACCEPTED', acceptedAt: new Date() },
    });

    await tx.conversation.update({
      where: { id: notif.conversationId },
      data:  {
        assignedUserId: userId,
        mode:           'HUMANO',
        aiEnabled:      false,
        status:         'EM_ATENDIMENTO',
      },
    });

    // Mensagem de sistema no histórico
    await tx.message.create({
      data: {
        conversationId: notif.conversationId,
        direction:      'OUTBOUND',
        type:           'TEXT',
        content:        `${userName} assumiu o atendimento`,
        senderType:     'SYSTEM',
        metadata:       JSON.stringify({ system: true, userId, userName }),
      },
    });

    await tx.automationLog.create({
      data: {
        type:           'SELLER_ACCEPTED',
        description:    `${userName} aceitou | conv: ${notif.conversationId}`,
        conversationId: notif.conversationId,
        leadId:         notif.leadId ?? undefined,
        userId,
      },
    });
  });

  emitConversationUpdate(notif.conversationId, {
    assignedUserId:   userId,
    assignedUserName: userName,
    mode:             'HUMANO',
    aiEnabled:        false,
    status:           'EM_ATENDIMENTO',
  });

  console.log(`[HANDOFF] SELLER_ACCEPTED | ${userName} | conv: ${notif.conversationId}`);

  // Disparar evento de fluxo (fire-and-forget)
  if (notif.leadId) {
    import('./flowEngine').then(({ triggerFlowsByEvent }) => {
      triggerFlowsByEvent('CONVERSATION_ASSIGNED', userId, notif.conversationId, notif.leadId!)
        .catch(() => {});
    }).catch(() => {});
  }

  return { ok: true };
}

// ─── Verificar expiração de notificação e escalar ────────────────────────────

export async function checkExpiry(notificationId: string): Promise<void> {
  const notif = await prisma.sellerNotification.findUnique({
    where:   { id: notificationId },
    include: { conversation: { include: { contact: true, lead: true } }, user: true },
  });

  if (!notif || notif.status !== 'PENDING') return;

  console.log(`[HANDOFF] SELLER_TIMEOUT | ${notif.user.name} | conv: ${notif.conversationId}`);

  await prisma.sellerNotification.update({
    where: { id: notificationId },
    data:  { status: 'EXPIRED' },
  });

  await prisma.automationLog.create({
    data: {
      type:           'SELLER_TIMEOUT',
      description:    `${notif.user.name} não aceitou em ${TIMEOUT_MINUTES}min | conv: ${notif.conversationId}`,
      conversationId: notif.conversationId,
      leadId:         notif.leadId ?? undefined,
      userId:         notif.userId,
    },
  });

  // Tentar próximo vendedor, excluindo todos os já notificados
  const alreadyNotified = await prisma.sellerNotification.findMany({
    where:  { conversationId: notif.conversationId },
    select: { userId: true },
  });
  const excludeIds = alreadyNotified.map(n => n.userId);

  const next = await findBestSeller(
    notif.conversation.storeId,
    notif.region,
    excludeIds,
  );

  if (!next || !notif.conversation.lead) {
    console.warn(`[HANDOFF] SELLER_ESCALATED — sem próximo vendedor | conv: ${notif.conversationId}`);
    await prisma.automationLog.create({
      data: {
        type:           'SELLER_ESCALATED',
        description:    `Sem mais vendedores após timeout | conv: ${notif.conversationId}`,
        conversationId: notif.conversationId,
        leadId:         notif.leadId ?? undefined,
      },
    });
    return;
  }

  const lead = notif.conversation.lead;
  console.log(`[HANDOFF] SELLER_ESCALATED → ${next.name} | conv: ${notif.conversationId}`);

  await createNotification(
    notif.conversationId,
    lead.id,
    next.id,
    next.name,
    notif.region,
    notif.summary ?? undefined,
    { name: notif.conversation.contact.name, phone: notif.conversation.contact.phone },
    lead.temperature,
  );

  await prisma.automationLog.create({
    data: {
      type:           'SELLER_ESCALATED',
      description:    `Escalado para ${next.name} após timeout | conv: ${notif.conversationId}`,
      conversationId: notif.conversationId,
      leadId:         lead.id,
    },
  });
}

// ─── Verificar notificações expiradas (chamado no webhook para robustez) ──────

export async function checkExpiredNotifications(): Promise<void> {
  const expired = await prisma.sellerNotification.findMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    select: { id: true },
  });

  for (const n of expired) {
    await checkExpiry(n.id).catch(e =>
      console.error('[HANDOFF] checkExpiredNotifications error:', e.message)
    );
  }
}
