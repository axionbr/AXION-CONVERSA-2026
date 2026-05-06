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
        const fields = await prisma.customField.findMany({ orderBy: { name: 'asc' } });
        res.json(fields);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', (0, auth_1.requireRole)('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
    try {
        const field = await prisma.customField.create({ data: req.body });
        res.status(201).json(field);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', (0, auth_1.requireRole)('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
    try {
        const field = await prisma.customField.update({ where: { id: req.params.id }, data: req.body });
        res.json(field);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', (0, auth_1.requireRole)('ADMIN'), async (req, res, next) => {
    try {
        await prisma.customField.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.post('/values', async (req, res, next) => {
    try {
        const { customFieldId, leadId, value } = req.body;
        const val = await prisma.customFieldValue.upsert({
            where: { customFieldId_leadId: { customFieldId, leadId } },
            update: { value },
            create: { customFieldId, leadId, value },
        });
        res.json(val);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=customFields.js.map