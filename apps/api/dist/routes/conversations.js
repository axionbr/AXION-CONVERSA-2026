"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const zapiService_1 = require("../services/zapiService");
const aiService_1 = require("../services/aiService");
const socket_1 = require("../socket");
const flowEngine_1 = require("../services/flowEngine");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
const OPEN_STATUSES = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];
const convInclude = {
    contact: true,
    lead: { include: { tags: { include: { tag: true } } } },
    assignedUser: { select: { id: true, name: true } },
    store: { select: { id: true, name: true } },
    messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { senderUser: { select: { id: true, name: true } } },
    },
};
// Inclui senderUser em qualquer consulta de mensagens
const msgInclude = {
    senderUser: { select: { id: true, name: true } },
};
function applyRoleFilter(where, user) {
    if (user.role === 'VENDEDOR' || user.role === 'ATENDENTE') {
        where.storeId = user.storeId;
    }
}
// GET /conversations
router.get('/', async (req, res, next) => {
    try {
        const { status, mode, storeId, assignedUserId, noReply, search, page = '1', limit = '20' } = req.query;
        const where = {};
        if (status)
            where.status = status;
        if (mode)
            where.mode = mode;
        if (storeId)
            where.storeId = storeId;
        if (assignedUserId)
            where.assignedUserId = assignedUserId;
        if (noReply === 'true') {
            where.lastMessageAt = { lt: new Date(Date.now() - 30 * 60 * 1000) };
            where.status = { in: OPEN_STATUSES };
        }
        if (search && typeof search === 'string' && search.trim()) {
            where.contact = {
                OR: [
                    { name: { contains: search.trim() } },
                    { phone: { contains: search.trim() } },
                ],
            };
        }
        applyRoleFilter(where, req.user);
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const [conversations, total] = await Promise.all([
            prisma.conversation.findMany({
                where,
                skip,
                take: limitNum,
                orderBy: { lastMessageAt: 'desc' },
                include: convInclude,
            }),
            prisma.conversation.count({ where }),
        ]);
        res.json({ conversations, total, page: pageNum, limit: limitNum });
    }
    catch (err) {
        next(err);
    }
});
// GET /conversations/live
router.get('/live', async (req, res, next) => {
    try {
        const where = { status: { in: OPEN_STATUSES } };
        applyRoleFilter(where, req.user);
        const conversations = await prisma.conversation.findMany({
            where,
            orderBy: { lastMessageAt: 'desc' },
            take: 50,
            include: convInclude,
        });
        res.json(conversations);
    }
    catch (err) {
        next(err);
    }
});
// GET /conversations/:id
router.get('/:id', async (req, res, next) => {
    try {
        const conversation = await prisma.conversation.findUnique({
            where: { id: req.params.id },
            include: { ...convInclude, messages: { orderBy: { createdAt: 'asc' }, include: msgInclude } },
        });
        if (!conversation)
            return res.status(404).json({ error: 'Conversa não encontrada' });
        res.json(conversation);
    }
    catch (err) {
        next(err);
    }
});
// GET /conversations/:id/messages — histórico completo com remetente
router.get('/:id/messages', async (req, res, next) => {
    try {
        const messages = await prisma.message.findMany({
            where: { conversationId: req.params.id },
            orderBy: { createdAt: 'asc' },
            include: msgInclude,
        });
        res.json(messages);
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/send — atendente envia mensagem pelo CRM
router.post('/:id/send', async (req, res, next) => {
    try {
        const { content } = req.body;
        if (!content?.trim())
            return res.status(400).json({ error: 'Conteúdo obrigatório' });
        const conv = await prisma.conversation.findUnique({
            where: { id: req.params.id },
            include: { contact: true },
        });
        if (!conv)
            return res.status(404).json({ error: 'Conversa não encontrada' });
        // Salva mensagem com senderType AGENT e FK para o usuário logado
        const msg = await prisma.message.create({
            data: {
                conversationId: req.params.id,
                direction: 'OUTBOUND',
                type: 'TEXT',
                content: content.trim(),
                senderType: 'AGENT',
                senderUserId: req.user.id,
            },
            include: msgInclude,
        });
        await prisma.conversation.update({
            where: { id: req.params.id },
            data: { lastMessageAt: new Date() },
        });
        console.log(`[AGENT] Mensagem salva | id: ${msg.id} | conversa: ${req.params.id} | atendente: ${req.user.email}`);
        // contact.phone esta sem DDI no DB ("11999..."); Z-API precisa do DDI ("5511999...")
        const zapiPhone = `55${conv.contact.phone}`;
        try {
            await (0, zapiService_1.sendTextMessage)(zapiPhone, content.trim(), conv.storeId);
            console.log(`[AGENT] Mensagem enviada via Z-API para ${zapiPhone}`);
        }
        catch (e) {
            console.error(`[AGENT] Falha ao enviar Z-API para ${zapiPhone}:`, e.message);
        }
        const msgPayload = {
            id: msg.id,
            conversationId: req.params.id,
            direction: 'OUTBOUND',
            type: 'TEXT',
            content: msg.content,
            senderType: 'AGENT',
            senderUser: msg.senderUser,
            createdAt: msg.createdAt.toISOString(),
        };
        (0, socket_1.emitNewMessage)(req.params.id, msgPayload);
        (0, socket_1.emitConversationUpdate)(req.params.id, {
            lastMessageAt: msg.createdAt.toISOString(),
        });
        res.json(msg);
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/assume
router.post('/:id/assume', async (req, res, next) => {
    try {
        const conv = await prisma.conversation.update({
            where: { id: req.params.id },
            data: {
                assignedUserId: req.user.id,
                mode: 'HUMANO',
                aiEnabled: false,
                status: 'EM_ATENDIMENTO',
            },
        });
        (0, socket_1.emitConversationUpdate)(req.params.id, { mode: 'HUMANO', assignedUserId: req.user.id, status: 'EM_ATENDIMENTO' });
        if (conv.leadId) {
            (0, flowEngine_1.triggerFlowsByEvent)('CONVERSATION_ASSIGNED', req.user.id, conv.id, conv.leadId)
                .catch((e) => console.error('[FLOW] CONVERSATION_ASSIGNED:', e.message));
        }
        res.json(conv);
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/wait
router.post('/:id/wait', async (req, res, next) => {
    try {
        const conv = await prisma.conversation.update({
            where: { id: req.params.id },
            data: { status: 'AGUARDANDO_CLIENTE' },
        });
        (0, socket_1.emitConversationUpdate)(req.params.id, { status: 'AGUARDANDO_CLIENTE' });
        res.json(conv);
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/close
router.post('/:id/close', async (req, res, next) => {
    try {
        const conv = await prisma.conversation.update({
            where: { id: req.params.id },
            data: { status: 'FECHADO', aiEnabled: false },
        });
        (0, socket_1.emitConversationUpdate)(req.params.id, { status: 'FECHADO' });
        if (conv.leadId) {
            (0, flowEngine_1.triggerFlowsByEvent)('CONVERSATION_CLOSED', '', conv.id, conv.leadId)
                .catch((e) => console.error('[FLOW] CONVERSATION_CLOSED:', e.message));
        }
        res.json(conv);
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/read
router.post('/:id/read', async (req, res, next) => {
    try {
        await prisma.conversation.update({
            where: { id: req.params.id },
            data: { unreadCount: 0 },
        });
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/pause-ai
router.post('/:id/pause-ai', async (req, res, next) => {
    try {
        const conv = await prisma.conversation.update({
            where: { id: req.params.id },
            data: { aiEnabled: false },
        });
        (0, socket_1.emitConversationUpdate)(req.params.id, { aiEnabled: false });
        res.json(conv);
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/resume-ai
router.post('/:id/resume-ai', async (req, res, next) => {
    try {
        const conv = await prisma.conversation.update({
            where: { id: req.params.id },
            data: { aiEnabled: true, mode: 'IA_AUTOMATICA' },
        });
        (0, socket_1.emitConversationUpdate)(req.params.id, { aiEnabled: true, mode: 'IA_AUTOMATICA' });
        res.json(conv);
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/transfer
router.post('/:id/transfer', async (req, res, next) => {
    try {
        const { userId } = req.body;
        if (!userId)
            return res.status(400).json({ error: 'userId obrigatório' });
        const conv = await prisma.conversation.update({
            where: { id: req.params.id },
            data: { assignedUserId: userId, mode: 'HUMANO', aiEnabled: false },
        });
        (0, socket_1.emitConversationUpdate)(req.params.id, { assignedUserId: userId, mode: 'HUMANO' });
        if (conv.leadId) {
            (0, flowEngine_1.triggerFlowsByEvent)('CONVERSATION_ASSIGNED', userId, conv.id, conv.leadId)
                .catch((e) => console.error('[FLOW] CONVERSATION_ASSIGNED (transfer):', e.message));
        }
        res.json(conv);
    }
    catch (err) {
        next(err);
    }
});
// GET /conversations/:id/analyze — busca analise mais recente salva
router.get('/:id/analyze', async (req, res, next) => {
    try {
        const log = await prisma.automationLog.findFirst({
            where: { conversationId: req.params.id, type: 'AI_ANALYSIS' },
            orderBy: { createdAt: 'desc' },
        });
        if (!log || !log.data)
            return res.json({ analysis: null });
        try {
            res.json({ analysis: JSON.parse(log.data) });
        }
        catch {
            res.json({ analysis: null });
        }
    }
    catch (err) {
        next(err);
    }
});
// POST /conversations/:id/analyze — solicita nova analise
router.post('/:id/analyze', async (req, res, next) => {
    try {
        const conv = await prisma.conversation.findUnique({
            where: { id: req.params.id },
            include: {
                messages: { orderBy: { createdAt: 'asc' }, take: 30 },
                lead: { select: { id: true, name: true, region: true, interest: true } },
            },
        });
        if (!conv)
            return res.status(404).json({ error: 'Conversa nao encontrada' });
        if (conv.messages.length === 0) {
            return res.json({ analysis: null, message: 'Sem mensagens para analisar' });
        }
        console.log(`[IA] Analisando conversa ${conv.id} (${conv.messages.length} mensagens)`);
        const analysis = await (0, aiService_1.analyzeConversation)(conv.messages.map(m => ({
            direction: m.direction,
            content: m.content,
            senderType: m.senderType,
        })), conv.storeId);
        await prisma.automationLog.create({
            data: {
                type: 'AI_ANALYSIS',
                description: `Analise IA da conversa`,
                data: JSON.stringify(analysis),
                conversationId: conv.id,
            },
        });
        // Persistir dados de qualificação extraídos no Lead
        if (conv.leadId && conv.lead) {
            const leadUpdate = {};
            // Região: priorizar dados da análise, não sobrescrever se já existir dado mais específico
            const regiaoExtraida = [analysis.cidade, analysis.bairro, analysis.regiao]
                .filter(Boolean).join(' - ');
            if (regiaoExtraida && !conv.lead.region) {
                leadUpdate.region = regiaoExtraida;
            }
            // Interesse/modelo — sobrescrever se a análise identificou algo
            if (analysis.modeloInteresse && analysis.modeloInteresse !== conv.lead.interest) {
                leadUpdate.interest = analysis.modeloInteresse;
            }
            if (Object.keys(leadUpdate).length > 0) {
                await prisma.lead.update({ where: { id: conv.leadId }, data: leadUpdate });
                console.log(`[IA] Lead ${conv.leadId} atualizado com dados da análise:`, leadUpdate);
            }
            // Atualizar temperatura do lead se a análise identificou temperatura mais alta
            const TEMP_ORDER = ['FRIO', 'MORNO', 'QUENTE', 'URGENTE'];
            const currentIdx = TEMP_ORDER.indexOf(conv.lead ? conv.lead?.temperature ?? 'FRIO' : 'FRIO');
            const analysisIdx = TEMP_ORDER.indexOf(analysis.temperatura);
            if (analysisIdx > currentIdx) {
                await prisma.lead.update({
                    where: { id: conv.leadId },
                    data: { temperature: analysis.temperatura },
                });
                console.log(`[IA] Lead temperatura atualizada: ${analysis.temperatura} | leadId: ${conv.leadId}`);
            }
        }
        console.log(`[IA] Analise salva | conv: ${conv.id} | tipo: ${analysis.tipo} | temp: ${analysis.temperatura}`);
        res.json({ analysis });
    }
    catch (err) {
        next(err);
    }
});
// PUT /conversations/:id/status
router.put('/:id/status', async (req, res, next) => {
    try {
        const { status } = req.body;
        const valid = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE', 'FECHADO'];
        if (!valid.includes(status))
            return res.status(400).json({ error: 'Status inválido', valid });
        const conv = await prisma.conversation.update({ where: { id: req.params.id }, data: { status } });
        (0, socket_1.emitConversationUpdate)(req.params.id, { status });
        res.json(conv);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=conversations.js.map