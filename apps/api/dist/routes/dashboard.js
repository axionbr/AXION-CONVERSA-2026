"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
// Status reais usados no banco
const OPEN_STATUSES = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];
const KANBAN_ORDER = ['NOVO_LEAD', 'QUALIFICADO', 'EM_NEGOCIACAO', 'AGUARDANDO_PAGAMENTO', 'VENDA_FECHADA', 'PERDIDO', 'POS_VENDA'];
router.get('/metrics', async (req, res, next) => {
    try {
        const where = {};
        if (req.user.role === 'VENDEDOR' || req.user.role === 'ATENDENTE') {
            where.storeId = req.user.storeId;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [totalConversations, activeConversations, awaitingHuman, resolvedToday, newLeadsToday, hotLeads, aiHandled,] = await Promise.all([
            prisma.conversation.count({ where }),
            // NOVO + EM_ATENDIMENTO = conversas abertas
            prisma.conversation.count({ where: { ...where, status: { in: ['NOVO', 'EM_ATENDIMENTO'] } } }),
            // AGUARDANDO_CLIENTE em modo humano = aguardando atendente
            prisma.conversation.count({ where: { ...where, status: 'AGUARDANDO_CLIENTE', mode: 'HUMANO' } }),
            // FECHADO hoje = resolvidas hoje
            prisma.conversation.count({ where: { ...where, status: 'FECHADO', updatedAt: { gte: today } } }),
            prisma.lead.count({ where: { ...where, createdAt: { gte: today } } }),
            prisma.lead.count({ where: { ...where, temperature: { in: ['QUENTE', 'URGENTE'] } } }),
            prisma.conversation.count({ where: { ...where, mode: 'IA_AUTOMATICA', aiEnabled: true } }),
        ]);
        res.json({
            totalConversations,
            activeConversations,
            awaitingHuman,
            resolvedToday,
            newLeadsToday,
            hotLeads,
            aiHandled,
        });
    }
    catch (err) {
        next(err);
    }
});
router.get('/live-conversations', async (req, res, next) => {
    try {
        // Usa status reais do banco
        const where = { status: { in: OPEN_STATUSES } };
        if (req.user.role === 'VENDEDOR' || req.user.role === 'ATENDENTE') {
            where.storeId = req.user.storeId;
        }
        const { storeId, assignedUserId, temperature, noReply } = req.query;
        if (storeId)
            where.storeId = storeId;
        if (assignedUserId)
            where.assignedUserId = assignedUserId;
        if (temperature)
            where.lead = { temperature };
        if (noReply === 'true') {
            const threshold = new Date(Date.now() - 30 * 60 * 1000);
            where.lastMessageAt = { lt: threshold };
        }
        const conversations = await prisma.conversation.findMany({
            where,
            orderBy: { lastMessageAt: 'desc' },
            take: 50,
            include: {
                contact: true,
                lead: { include: { tags: { include: { tag: true } } } },
                assignedUser: { select: { id: true, name: true } },
                store: { select: { id: true, name: true } },
                messages: { orderBy: { createdAt: 'desc' }, take: 3 },
            },
        });
        res.json(conversations);
    }
    catch (err) {
        next(err);
    }
});
router.get('/charts', async (req, res, next) => {
    try {
        const where = {};
        if (req.user.role === 'VENDEDOR' || req.user.role === 'ATENDENTE') {
            where.storeId = req.user.storeId;
        }
        const period = req.query.period || '7d';
        const now = new Date();
        let startDate;
        let isHourly = false;
        if (period === 'today') {
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            isHourly = true;
        }
        else if (period === '30d' || period === 'month') {
            startDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
            startDate.setHours(0, 0, 0, 0);
        }
        else {
            startDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
            startDate.setHours(0, 0, 0, 0);
        }
        const messageWhere = { createdAt: { gte: startDate } };
        if (where.storeId)
            messageWhere.conversation = { storeId: where.storeId };
        const leadWhere = where.storeId ? { storeId: where.storeId } : {};
        const [conversationsInPeriod, allConversations, allLeads, messagesInPeriod] = await Promise.all([
            prisma.conversation.findMany({
                where: { ...where, createdAt: { gte: startDate } },
                select: { createdAt: true },
            }),
            prisma.conversation.findMany({ where, select: { status: true } }),
            // Inclui temperatura, kanbanStage e responsável para derivar 4 gráficos em 1 query
            prisma.lead.findMany({
                where: leadWhere,
                select: {
                    temperature: true,
                    kanbanStage: true,
                    assignedUser: { select: { name: true } },
                },
            }),
            prisma.message.findMany({ where: messageWhere, select: { direction: true } }),
        ]);
        // ── Conversas por período ──────────────────────────────────────────────────
        const buckets = {};
        if (isHourly) {
            for (let h = 0; h <= now.getHours(); h++) {
                buckets[`${String(h).padStart(2, '0')}:00`] = 0;
            }
            conversationsInPeriod.forEach(c => {
                const key = `${String(new Date(c.createdAt).getHours()).padStart(2, '0')}:00`;
                if (key in buckets)
                    buckets[key]++;
            });
        }
        else {
            const days = period === '30d' || period === 'month' ? 30 : 7;
            for (let i = 0; i < days; i++) {
                const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
                buckets[d.toISOString().slice(0, 10)] = 0;
            }
            conversationsInPeriod.forEach(c => {
                const key = new Date(c.createdAt).toISOString().slice(0, 10);
                if (key in buckets)
                    buckets[key]++;
            });
        }
        const conversationsByDay = Object.entries(buckets).map(([date, count]) => ({ date, count }));
        // ── Status das conversas ───────────────────────────────────────────────────
        const statusMap = {};
        allConversations.forEach(c => {
            statusMap[c.status] = (statusMap[c.status] || 0) + 1;
        });
        const statusDistribution = Object.entries(statusMap)
            .map(([status, count]) => ({ status, count }))
            .sort((a, b) => b.count - a.count);
        // ── Temperatura dos leads ──────────────────────────────────────────────────
        const tempOrder = ['FRIO', 'MORNO', 'QUENTE', 'URGENTE'];
        const tempMap = { FRIO: 0, MORNO: 0, QUENTE: 0, URGENTE: 0 };
        allLeads.forEach(l => { if (l.temperature in tempMap)
            tempMap[l.temperature]++; });
        const leadTemperature = tempOrder.map(t => ({ temperature: t, count: tempMap[t] }));
        // ── Mensagens recebidas × enviadas ─────────────────────────────────────────
        let inbound = 0, outbound = 0;
        messagesInPeriod.forEach(m => {
            if (m.direction === 'INBOUND')
                inbound++;
            else
                outbound++;
        });
        // ── Leads por responsável ──────────────────────────────────────────────────
        const userMap = {};
        allLeads.forEach(l => {
            const name = l.assignedUser?.name ?? 'Sem responsável';
            userMap[name] = (userMap[name] || 0) + 1;
        });
        const leadsByUser = Object.entries(userMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        // ── Funil Kanban ───────────────────────────────────────────────────────────
        const kanbanMap = {};
        KANBAN_ORDER.forEach(k => { kanbanMap[k] = 0; });
        allLeads.forEach(l => {
            const stage = l.kanbanStage || 'NOVO_LEAD';
            if (stage in kanbanMap)
                kanbanMap[stage]++;
            else
                kanbanMap['NOVO_LEAD']++;
        });
        const kanbanStages = KANBAN_ORDER.map(k => ({ stage: k, count: kanbanMap[k] }));
        res.json({
            conversationsByDay,
            statusDistribution,
            leadTemperature,
            messagesByDirection: { inbound, outbound },
            leadsByUser,
            kanbanStages,
        });
    }
    catch (err) {
        next(err);
    }
});
router.get('/automation-logs', async (req, res, next) => {
    try {
        const logs = await prisma.automationLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { conversation: true, lead: true },
        });
        res.json(logs);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map