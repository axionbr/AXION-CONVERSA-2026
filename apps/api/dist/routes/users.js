"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
function strip(user) {
    if (!user)
        return user;
    const { password, ...safe } = user;
    return safe;
}
router.use(auth_1.authenticate);
router.get('/', async (req, res, next) => {
    try {
        const { storeId } = req.query;
        const where = {};
        if (storeId)
            where.storeId = storeId;
        if (req.user.role !== 'ADMIN' && req.user.role !== 'DIRETOR') {
            where.storeId = req.user.storeId;
        }
        const users = await prisma.user.findMany({ where, include: { store: true } });
        res.json(users.map(strip));
    }
    catch (err) {
        next(err);
    }
});
router.post('/', (0, auth_1.requireRole)('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
    try {
        const { name, email, password, role, storeId } = req.body;
        const hash = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma.user.create({ data: { name, email, password: hash, role, storeId } });
        res.status(201).json(strip(user));
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', (0, auth_1.requireRole)('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
    try {
        const { password, ...data } = req.body;
        const updateData = { ...data };
        if (password)
            updateData.password = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma.user.update({ where: { id: req.params.id }, data: updateData });
        res.json(strip(user));
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', (0, auth_1.requireRole)('ADMIN', 'DIRETOR'), async (req, res, next) => {
    try {
        await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map