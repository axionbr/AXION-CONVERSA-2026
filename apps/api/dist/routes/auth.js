"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
function strip(user) {
    if (!user)
        return user;
    const { password, ...safe } = user;
    return safe;
}
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email e senha obrigatórios' });
        const user = await prisma.user.findUnique({ where: { email }, include: { store: true } });
        if (!user || !user.active)
            return res.status(401).json({ error: 'Credenciais inválidas' });
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid)
            return res.status(401).json({ error: 'Credenciais inválidas' });
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role, storeId: user.storeId }, config_1.config.jwtSecret, { expiresIn: config_1.config.jwtExpiresIn });
        res.json({ token, user: strip(user) });
    }
    catch (err) {
        next(err);
    }
});
router.get('/me', auth_1.authenticate, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { store: true },
        });
        res.json(strip(user));
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map