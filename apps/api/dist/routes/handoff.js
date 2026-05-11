"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const handoffService_1 = require("../services/handoffService");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
// GET /handoff/pending — notificações pendentes do vendedor logado
router.get('/pending', async (req, res, next) => {
    try {
        const notifications = await prisma.sellerNotification.findMany({
            where: {
                userId: req.user.id,
                status: 'PENDING',
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
            include: {
                conversation: {
                    include: {
                        contact: true,
                        lead: { select: { id: true, temperature: true, source: true, region: true } },
                        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
                    },
                },
            },
        });
        res.json(notifications);
    }
    catch (err) {
        next(err);
    }
});
// POST /handoff/:notificationId/accept — vendedor aceita o atendimento
router.post('/:notificationId/accept', async (req, res, next) => {
    try {
        const result = await (0, handoffService_1.acceptHandoff)(req.params.notificationId, req.user.id);
        if (!result.ok) {
            return res.status(400).json({ error: result.error });
        }
        res.json({ accepted: true });
    }
    catch (err) {
        next(err);
    }
});
// POST /handoff/:conversationId/initiate — iniciar handoff manual (gestor/admin)
router.post('/:conversationId/initiate', async (req, res, next) => {
    try {
        const conv = await prisma.conversation.findUnique({
            where: { id: req.params.conversationId },
            include: { lead: true },
        });
        if (!conv)
            return res.status(404).json({ error: 'Conversa não encontrada' });
        if (!conv.lead)
            return res.status(400).json({ error: 'Conversa sem lead vinculado' });
        await (0, handoffService_1.initiateHandoff)(req.params.conversationId, {
            id: conv.lead.id,
            phone: conv.lead.phone,
            temperature: conv.lead.temperature,
            storeId: conv.storeId,
            region: conv.lead.region,
        }, req.body.summary);
        res.json({ initiated: true });
    }
    catch (err) {
        next(err);
    }
});
// POST /handoff/check-expired — forçar verificação de notificações expiradas (cron/admin)
router.post('/check-expired', async (_req, res, next) => {
    try {
        await (0, handoffService_1.checkExpiredNotifications)();
        res.json({ checked: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=handoff.js.map