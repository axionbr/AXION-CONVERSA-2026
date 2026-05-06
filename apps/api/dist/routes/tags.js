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
        const tags = await prisma.tag.findMany({ include: { _count: { select: { leads: true } } }, orderBy: { name: 'asc' } });
        res.json(tags);
    }
    catch (err) {
        next(err);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const tag = await prisma.tag.create({ data: req.body });
        res.status(201).json(tag);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', async (req, res, next) => {
    try {
        const tag = await prisma.tag.update({ where: { id: req.params.id }, data: req.body });
        res.json(tag);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', async (req, res, next) => {
    try {
        await prisma.tag.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=tags.js.map