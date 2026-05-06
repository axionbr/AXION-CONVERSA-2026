"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
router.get('/', async (req, res, next) => {
    try {
        const { status, temperature, storeId, assignedUserId, search, page = '1', limit = '20' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = {};
        if (status)
            where.status = status;
        if (temperature)
            where.temperature = temperature;
        if (storeId)
            where.storeId = storeId;
        if (assignedUserId)
            where.assignedUserId = assignedUserId;
        if (req.user.role === 'VENDEDOR' || req.user.role === 'ATENDENTE') {
            where.storeId = req.user.storeId;
        }
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
            ];
        }
        const [leads, total] = await Promise.all([
            prisma.lead.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: [{ priority: 'desc' }, { score: 'desc' }, { updatedAt: 'desc' }],
                include: {
                    store: { select: { id: true, name: true } },
                    assignedUser: { select: { id: true, name: true } },
                    tags: { include: { tag: true } },
                },
            }),
            prisma.lead.count({ where }),
        ]);
        res.json({ leads, total, page: parseInt(page) });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const lead = await prisma.lead.findUnique({
            where: { id: req.params.id },
            include: {
                store: true,
                assignedUser: { select: { id: true, name: true, email: true } },
                tags: { include: { tag: true } },
                customValues: { include: { customField: true } },
                conversations: { orderBy: { createdAt: 'desc' }, take: 3 },
                automationLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
            },
        });
        if (!lead)
            return res.status(404).json({ error: 'Lead não encontrado' });
        res.json(lead);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const lead = await prisma.lead.create({
            data: req.body,
            include: { store: true, assignedUser: { select: { id: true, name: true } } },
        });
        res.status(201).json(lead);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', async (req, res, next) => {
    try {
        const lead = await prisma.lead.update({
            where: { id: req.params.id },
            data: req.body,
            include: {
                store: true,
                assignedUser: { select: { id: true, name: true } },
                tags: { include: { tag: true } },
            },
        });
        res.json(lead);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/tags', async (req, res, next) => {
    try {
        const { tagId } = req.body;
        await prisma.leadTag.upsert({
            where: { leadId_tagId: { leadId: req.params.id, tagId } },
            update: {},
            create: { leadId: req.params.id, tagId },
        });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id/tags/:tagId', async (req, res, next) => {
    try {
        await prisma.leadTag.delete({ where: { leadId_tagId: { leadId: req.params.id, tagId: req.params.tagId } } });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=leads.js.map