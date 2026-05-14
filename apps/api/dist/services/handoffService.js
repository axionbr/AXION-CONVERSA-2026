"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HANDOFF_MSG = void 0;
exports.extractRegion = extractRegion;
exports.findBestSeller = findBestSeller;
exports.initiateHandoff = initiateHandoff;
exports.acceptHandoff = acceptHandoff;
exports.checkExpiry = checkExpiry;
exports.checkExpiredNotifications = checkExpiredNotifications;
const client_1 = require("@prisma/client");
const outboundWhatsAppService_1 = require("./outboundWhatsAppService");
const socket_1 = require("../socket");
const prisma = new client_1.PrismaClient();
// Minutos antes de uma notificação expirar e escalar para o próximo vendedor
const TIMEOUT_MINUTES = 1;
// Mensagem enviada pelo número central ao cliente durante o handoff
exports.HANDOFF_MSG = 'Ótimo, já entendi o que você procura. Vou te passar agora para um especialista da ' +
    'nossa equipe que atende a sua região, assim ele consegue te orientar com as melhores opções ' +
    'e condições disponíveis.';
// ─── Extração de região do texto ─────────────────────────────────────────────
// Mapa de cidade/bairro → região normalizada para roteamento
const REGION_KEYWORDS = [
    // São Paulo (capital + bairros)
    ['são paulo', 'SP - São Paulo'],
    ['zona sul', 'SP - São Paulo / Zona Sul'],
    ['zona norte', 'SP - São Paulo / Zona Norte'],
    ['zona leste', 'SP - São Paulo / Zona Leste'],
    ['zona oeste', 'SP - São Paulo / Zona Oeste'],
    ['centro de sp', 'SP - São Paulo / Centro'],
    ['abc paulista', 'SP - ABC Paulista'],
    ['santo andré', 'SP - ABC / Santo André'],
    ['são bernardo', 'SP - ABC / São Bernardo'],
    ['são caetano', 'SP - ABC / São Caetano'],
    ['guarulhos', 'SP - Guarulhos'],
    ['osasco', 'SP - Osasco'],
    ['campinas', 'SP - Campinas'],
    ['sorocaba', 'SP - Sorocaba'],
    ['ribeirão preto', 'SP - Ribeirão Preto'],
    ['santos', 'SP - Santos / Baixada Santista'],
    ['são vicente', 'SP - Santos / Baixada Santista'],
    ['praia grande', 'SP - Santos / Baixada Santista'],
    ['bauru', 'SP - Bauru'],
    ['marília', 'SP - Marília'],
    ['presidente prudente', 'SP - Presidente Prudente'],
    ['são josé dos campos', 'SP - São José dos Campos'],
    ['jundiaí', 'SP - Jundiaí'],
    ['piracicaba', 'SP - Piracicaba'],
    // Rio de Janeiro
    ['rio de janeiro', 'RJ - Rio de Janeiro'],
    ['niterói', 'RJ - Niterói'],
    ['nova iguaçu', 'RJ - Baixada Fluminense'],
    ['duque de caxias', 'RJ - Baixada Fluminense'],
    ['petrópolis', 'RJ - Petrópolis'],
    // Minas Gerais
    ['belo horizonte', 'MG - Belo Horizonte'],
    ['uberlândia', 'MG - Uberlândia'],
    ['contagem', 'MG - Grande BH'],
    ['juiz de fora', 'MG - Juiz de Fora'],
    // Sul
    ['curitiba', 'PR - Curitiba'],
    ['londrina', 'PR - Londrina'],
    ['maringá', 'PR - Maringá'],
    ['florianópolis', 'SC - Florianópolis'],
    ['joinville', 'SC - Joinville'],
    ['blumenau', 'SC - Blumenau'],
    ['porto alegre', 'RS - Porto Alegre'],
    ['caxias do sul', 'RS - Caxias do Sul'],
    // Nordeste
    ['salvador', 'BA - Salvador'],
    ['feira de santana', 'BA - Feira de Santana'],
    ['recife', 'PE - Recife'],
    ['caruaru', 'PE - Caruaru'],
    ['fortaleza', 'CE - Fortaleza'],
    ['natal', 'RN - Natal'],
    ['joão pessoa', 'PB - João Pessoa'],
    ['maceió', 'AL - Maceió'],
    ['aracaju', 'SE - Aracaju'],
    ['são luís', 'MA - São Luís'],
    ['teresina', 'PI - Teresina'],
    // Centro-Oeste / Norte
    ['brasília', 'DF - Brasília'],
    ['goiânia', 'GO - Goiânia'],
    ['anápolis', 'GO - Anápolis'],
    ['campo grande', 'MS - Campo Grande'],
    ['cuiabá', 'MT - Cuiabá'],
    ['manaus', 'AM - Manaus'],
    ['belém', 'PA - Belém'],
    ['porto velho', 'RO - Porto Velho'],
];
// DDD → estado/região para fallback quando cidade não é detectada
const DDD_REGION = {
    '11': 'SP - São Paulo (capital)',
    '12': 'SP - São José dos Campos',
    '13': 'SP - Santos / Baixada Santista',
    '14': 'SP - Bauru',
    '15': 'SP - Sorocaba',
    '16': 'SP - Ribeirão Preto',
    '17': 'SP - São José do Rio Preto',
    '18': 'SP - Presidente Prudente',
    '19': 'SP - Campinas',
    '21': 'RJ - Rio de Janeiro',
    '22': 'RJ - Campos dos Goytacazes',
    '24': 'RJ - Volta Redonda',
    '27': 'ES - Vitória',
    '28': 'ES - Cachoeiro de Itapemirim',
    '31': 'MG - Belo Horizonte',
    '32': 'MG - Juiz de Fora',
    '33': 'MG - Governador Valadares',
    '34': 'MG - Uberlândia',
    '35': 'MG - Poços de Caldas',
    '37': 'MG - Divinópolis',
    '38': 'MG - Montes Claros',
    '41': 'PR - Curitiba',
    '42': 'PR - Ponta Grossa',
    '43': 'PR - Londrina',
    '44': 'PR - Maringá',
    '45': 'PR - Cascavel',
    '46': 'PR - Francisco Beltrão',
    '47': 'SC - Joinville',
    '48': 'SC - Florianópolis',
    '49': 'SC - Chapecó',
    '51': 'RS - Porto Alegre',
    '53': 'RS - Pelotas',
    '54': 'RS - Caxias do Sul',
    '55': 'RS - Santa Maria',
    '61': 'DF - Brasília',
    '62': 'GO - Goiânia',
    '63': 'TO - Palmas',
    '64': 'GO - Rio Verde',
    '65': 'MT - Cuiabá',
    '66': 'MT - Rondonópolis',
    '67': 'MS - Campo Grande',
    '68': 'AC - Rio Branco',
    '69': 'RO - Porto Velho',
    '71': 'BA - Salvador',
    '73': 'BA - Ilhéus',
    '74': 'BA - Juazeiro',
    '75': 'BA - Feira de Santana',
    '77': 'BA - Vitória da Conquista',
    '79': 'SE - Aracaju',
    '81': 'PE - Recife',
    '82': 'AL - Maceió',
    '83': 'PB - João Pessoa',
    '84': 'RN - Natal',
    '85': 'CE - Fortaleza',
    '86': 'PI - Teresina',
    '87': 'PE - Petrolina',
    '88': 'CE - Juazeiro do Norte',
    '89': 'PI - Picos',
    '91': 'PA - Belém',
    '92': 'AM - Manaus',
    '93': 'PA - Santarém',
    '94': 'PA - Marabá',
    '95': 'RR - Boa Vista',
    '96': 'AP - Macapá',
    '97': 'AM - Coari',
    '98': 'MA - São Luís',
    '99': 'MA - Imperatriz',
};
function extractRegion(text) {
    const lower = text.toLowerCase();
    // 1. Cidades/bairros/regiões por nome (tabela expandida)
    for (const [kw, norm] of REGION_KEYWORDS) {
        if (lower.includes(kw))
            return norm;
    }
    // 2. DDD com parênteses (ex: "(11)", "(021)") — formato mais comum em texto
    const dddParen = text.match(/\(0?(\d{2})\)/);
    if (dddParen) {
        const ddd = dddParen[1];
        if (DDD_REGION[ddd])
            return DDD_REGION[ddd];
    }
    // 3. DDD como palavra isolada (ex: "DDD 11", "sou do 11")
    const dddWord = text.match(/\b(1[1-9]|2[1-9]|3[1-4]|3[7-8]|4[1-9]|5[1-5]|6[1-9]|7[1-9]|8[1-9]|9[1-9])\b/);
    if (dddWord) {
        const ddd = dddWord[1];
        if (DDD_REGION[ddd])
            return DDD_REGION[ddd];
        return `DDD ${ddd}`;
    }
    return null;
}
// ─── Encontra o melhor vendedor para a região ─────────────────────────────────
async function findBestSeller(storeId, region, excludeIds = []) {
    const base = {
        active: true,
        available: true, // ignora vendedores offline/indisponíveis
        role: { in: ['VENDEDOR', 'ATENDENTE', 'GERENTE'] },
        id: { notIn: excludeIds.length ? excludeIds : ['__none__'] },
    };
    if (storeId)
        base.storeId = storeId;
    const sellers = await prisma.user.findMany({
        where: base,
        select: { id: true, name: true, region: true, city: true },
        orderBy: { createdAt: 'asc' },
    });
    if (!sellers.length)
        return null;
    if (region) {
        const rLow = region.toLowerCase();
        // Tentativa 1: match exato na cidade do vendedor
        const cityMatch = sellers.find(s => {
            const c = s.city ?? '';
            return c.length > 0 && rLow.includes(c.toLowerCase());
        });
        if (cityMatch) {
            console.log(`[ROUTING] Match por cidade: ${cityMatch.name} (city: ${cityMatch.city})`);
            return { id: cityMatch.id, name: cityMatch.name };
        }
        // Tentativa 2: match na região (texto parcial bidirecional)
        const regionMatch = sellers.find(s => {
            const r = s.region ?? '';
            if (!r)
                return false;
            const sr = r.toLowerCase();
            return sr.includes(rLow) || rLow.includes(sr);
        });
        if (regionMatch) {
            console.log(`[ROUTING] Match por região: ${regionMatch.name} (region: ${regionMatch.region})`);
            return { id: regionMatch.id, name: regionMatch.name };
        }
        // Tentativa 3: match por estado (primeiros 2 chars: "SP", "RJ", etc.)
        const statePrefix = rLow.substring(0, 2);
        const stateMatch = sellers.find(s => {
            const r = s.region ?? '';
            return r.length > 0 && r.toLowerCase().startsWith(statePrefix);
        });
        if (stateMatch) {
            console.log(`[ROUTING] Match por estado: ${stateMatch.name} (prefix: ${statePrefix})`);
            return { id: stateMatch.id, name: stateMatch.name };
        }
    }
    // Fallback: primeiro vendedor disponível da loja / sistema
    console.log(`[ROUTING] Sem match regional — usando primeiro disponível: ${sellers[0].name}`);
    return { id: sellers[0].id, name: sellers[0].name };
}
// ─── Cria notificação para vendedor + emite socket ────────────────────────────
async function createNotification(conversationId, leadId, userId, userName, region, summary, contact, leadTemp) {
    const expiresAt = new Date(Date.now() + TIMEOUT_MINUTES * 60000);
    const notif = await prisma.sellerNotification.create({
        data: {
            conversationId,
            leadId: leadId ?? undefined,
            userId,
            region,
            summary,
            expiresAt,
            status: 'PENDING',
        },
    });
    await prisma.automationLog.create({
        data: {
            type: 'SELLER_NOTIFIED',
            description: `Vendedor ${userName} notificado para conv: ${conversationId}`,
            conversationId,
            leadId: leadId ?? undefined,
            userId,
        },
    });
    console.log(`[SELLER_NOTIFIED] | vendedor: ${userName} | conv: ${conversationId} | expira: ${expiresAt.toISOString()}`);
    // Emite para a sala pessoal do vendedor
    (0, socket_1.emitToUser)(userId, 'handoff:notification', {
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
        checkExpiry(notif.id).catch(e => console.error('[HANDOFF] Erro no checkExpiry:', e.message));
    }, TIMEOUT_MINUTES * 60000 + 5000);
    return notif.id;
}
// ─── Inicia o processo de handoff ─────────────────────────────────────────────
async function initiateHandoff(conversationId, lead, aiSummary) {
    // Evita handoff duplicado na mesma conversa
    const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true },
    });
    if (!conv)
        return;
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
        data: { mode: 'AGUARDANDO_HUMANO', aiEnabled: false, status: 'EM_ATENDIMENTO' },
    });
    (0, socket_1.emitConversationUpdate)(conversationId, {
        mode: 'AGUARDANDO_HUMANO',
        aiEnabled: false,
        status: 'EM_ATENDIMENTO',
    });
    // Log obrigatório de início do handoff
    await prisma.automationLog.create({
        data: {
            type: 'HANDOFF_STARTED',
            description: `Handoff iniciado | temperatura: ${lead.temperature} | região: ${lead.region ?? 'não informada'}`,
            data: JSON.stringify({ leadId: lead.id, temperature: lead.temperature, storeId: lead.storeId }),
            conversationId,
            leadId: lead.id,
        },
    }).catch(() => { });
    console.log(`[HANDOFF_STARTED] | conv: ${conversationId} | lead: ${lead.id} | temp: ${lead.temperature}`);
    // 2. Extrair região da conversa
    const msgs = await prisma.message.findMany({
        where: { conversationId, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { content: true },
    });
    const allText = msgs.map(m => m.content).join(' ');
    const region = lead.region || extractRegion(allText);
    // Persistir região extraída no Lead se ainda não estiver salva
    if (region && !lead.region) {
        await prisma.lead.update({ where: { id: lead.id }, data: { region } })
            .catch(() => { });
        console.log(`[HANDOFF] Região salva no lead | id: ${lead.id} | region: ${region}`);
    }
    // 3. Enviar mensagem de transferência ao cliente pelo número central
    const sendResult = await (0, outboundWhatsAppService_1.sendWhatsAppText)({
        conversationId,
        storeId: conv.storeId,
        phone: conv.contact.phone,
        text: exports.HANDOFF_MSG,
        source: 'system',
    });
    if (sendResult.ok) {
        const sysMsg = await prisma.message.create({
            data: {
                conversationId,
                direction: 'OUTBOUND',
                type: 'TEXT',
                content: exports.HANDOFF_MSG,
                senderType: 'AI',
            },
        });
        (0, socket_1.emitNewMessage)(conversationId, {
            id: sysMsg.id,
            conversationId,
            direction: 'OUTBOUND',
            type: 'TEXT',
            content: exports.HANDOFF_MSG,
            senderType: 'AI',
            createdAt: sysMsg.createdAt.toISOString(),
        });
        console.log(`[HANDOFF] Mensagem de transferência enviada | conv: ${conversationId}`);
    }
    else {
        console.error(`[HANDOFF] Falha ao enviar mensagem de transferência | conv: ${conversationId} | erro: ${sendResult.error}`);
    }
    // 4. Encontrar e notificar vendedor
    const seller = await findBestSeller(conv.storeId, region);
    if (!seller) {
        console.warn(`[HANDOFF] Sem vendedor disponível — fila geral | conv: ${conversationId}`);
        await prisma.automationLog.create({
            data: {
                type: 'SELLER_ESCALATED',
                description: 'Nenhum vendedor disponível — conversa na fila geral',
                conversationId,
                leadId: lead.id,
            },
        });
        return;
    }
    await createNotification(conversationId, lead.id, seller.id, seller.name, region, aiSummary, { name: conv.contact.name, phone: conv.contact.phone }, lead.temperature);
}
// ─── Vendedor aceita o handoff ────────────────────────────────────────────────
async function acceptHandoff(notificationId, userId) {
    const notif = await prisma.sellerNotification.findUnique({
        where: { id: notificationId },
        include: { user: true },
    });
    if (!notif)
        return { ok: false, error: 'Notificação não encontrada' };
    if (notif.userId !== userId)
        return { ok: false, error: 'Notificação não pertence a você' };
    if (notif.status === 'ACCEPTED')
        return { ok: false, error: 'Já aceito' };
    if (notif.status === 'EXPIRED')
        return { ok: false, error: 'Notificação expirada — conversa foi repassada' };
    if (new Date() > notif.expiresAt)
        return { ok: false, error: 'Tempo esgotado' };
    const userName = notif.user.name;
    await prisma.$transaction(async (tx) => {
        await tx.sellerNotification.update({
            where: { id: notificationId },
            data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
        await tx.conversation.update({
            where: { id: notif.conversationId },
            data: {
                assignedUserId: userId,
                mode: 'HUMANO',
                aiEnabled: false,
                status: 'EM_ATENDIMENTO',
            },
        });
        // Mensagem de sistema no histórico
        await tx.message.create({
            data: {
                conversationId: notif.conversationId,
                direction: 'OUTBOUND',
                type: 'TEXT',
                content: `${userName} assumiu o atendimento`,
                senderType: 'SYSTEM',
                metadata: JSON.stringify({ system: true, userId, userName }),
            },
        });
        await tx.automationLog.create({
            data: {
                type: 'SELLER_ACCEPTED',
                description: `${userName} aceitou | conv: ${notif.conversationId}`,
                conversationId: notif.conversationId,
                leadId: notif.leadId ?? undefined,
                userId,
            },
        });
    });
    (0, socket_1.emitConversationUpdate)(notif.conversationId, {
        assignedUserId: userId,
        assignedUserName: userName,
        mode: 'HUMANO',
        aiEnabled: false,
        status: 'EM_ATENDIMENTO',
    });
    console.log(`[HANDOFF] SELLER_ACCEPTED | ${userName} | conv: ${notif.conversationId}`);
    // Disparar evento de fluxo (fire-and-forget)
    if (notif.leadId) {
        Promise.resolve().then(() => __importStar(require('./flowEngine'))).then(({ triggerFlowsByEvent }) => {
            triggerFlowsByEvent('CONVERSATION_ASSIGNED', userId, notif.conversationId, notif.leadId)
                .catch(() => { });
        }).catch(() => { });
    }
    return { ok: true };
}
// ─── Verificar expiração de notificação e escalar ────────────────────────────
async function checkExpiry(notificationId) {
    const notif = await prisma.sellerNotification.findUnique({
        where: { id: notificationId },
        include: { conversation: { include: { contact: true, lead: true } }, user: true },
    });
    if (!notif || notif.status !== 'PENDING')
        return;
    console.log(`[HANDOFF] SELLER_TIMEOUT | ${notif.user.name} | conv: ${notif.conversationId}`);
    await prisma.sellerNotification.update({
        where: { id: notificationId },
        data: { status: 'EXPIRED' },
    });
    await prisma.automationLog.create({
        data: {
            type: 'SELLER_TIMEOUT',
            description: `${notif.user.name} não aceitou em ${TIMEOUT_MINUTES}min | conv: ${notif.conversationId}`,
            conversationId: notif.conversationId,
            leadId: notif.leadId ?? undefined,
            userId: notif.userId,
        },
    });
    // Tentar próximo vendedor, excluindo todos os já notificados
    const alreadyNotified = await prisma.sellerNotification.findMany({
        where: { conversationId: notif.conversationId },
        select: { userId: true },
    });
    const excludeIds = alreadyNotified.map(n => n.userId);
    const next = await findBestSeller(notif.conversation.storeId, notif.region, excludeIds);
    if (!next || !notif.conversation.lead) {
        console.warn(`[HANDOFF] SELLER_ESCALATED — sem próximo vendedor | conv: ${notif.conversationId}`);
        await prisma.automationLog.create({
            data: {
                type: 'SELLER_ESCALATED',
                description: `Sem mais vendedores após timeout | conv: ${notif.conversationId}`,
                conversationId: notif.conversationId,
                leadId: notif.leadId ?? undefined,
            },
        });
        return;
    }
    const lead = notif.conversation.lead;
    console.log(`[HANDOFF] SELLER_ESCALATED → ${next.name} | conv: ${notif.conversationId}`);
    await createNotification(notif.conversationId, lead.id, next.id, next.name, notif.region, notif.summary ?? undefined, { name: notif.conversation.contact.name, phone: notif.conversation.contact.phone }, lead.temperature);
    await prisma.automationLog.create({
        data: {
            type: 'SELLER_ESCALATED',
            description: `Escalado para ${next.name} após timeout | conv: ${notif.conversationId}`,
            conversationId: notif.conversationId,
            leadId: lead.id,
        },
    });
}
// ─── Verificar notificações expiradas (chamado no webhook para robustez) ──────
async function checkExpiredNotifications() {
    const expired = await prisma.sellerNotification.findMany({
        where: { status: 'PENDING', expiresAt: { lt: new Date() } },
        select: { id: true },
    });
    for (const n of expired) {
        await checkExpiry(n.id).catch(e => console.error('[HANDOFF] checkExpiredNotifications error:', e.message));
    }
}
//# sourceMappingURL=handoffService.js.map