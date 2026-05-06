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
        const stores = await prisma.store.findMany({ where: { active: true }, include: { _count: { select: { users: true, leads: true } } } });
        res.json(stores);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', (0, auth_1.requireRole)('ADMIN', 'DIRETOR'), async (req, res, next) => {
    try {
        const store = await prisma.store.create({ data: req.body });
        res.status(201).json(store);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', (0, auth_1.requireRole)('ADMIN', 'DIRETOR'), async (req, res, next) => {
    try {
        const store = await prisma.store.update({ where: { id: req.params.id }, data: req.body });
        res.json(store);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', (0, auth_1.requireRole)('ADMIN'), async (req, res, next) => {
    try {
        await prisma.store.update({ where: { id: req.params.id }, data: { active: false } });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=stores.js.map