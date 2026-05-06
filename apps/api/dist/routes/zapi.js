"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const zapiService_1 = require("../services/zapiService");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
router.get('/config', async (req, res, next) => {
    try {
        const configs = await prisma.zapiConfig.findMany({ include: { store: true } });
        res.json(configs.map((c) => ({ ...c, token: '***', clientToken: '***' })));
    }
    catch (err) {
        next(err);
    }
});
router.post('/config', (0, auth_1.requireRole)('ADMIN', 'DIRETOR'), async (req, res, next) => {
    try {
        const { storeId, ...data } = req.body;
        const config = await prisma.zapiConfig.upsert({
            where: { storeId: storeId || undefined },
            update: data,
            create: { storeId, ...data },
        });
        res.json({ ...config, token: '***', clientToken: '***' });
    }
    catch (err) {
        next(err);
    }
});
router.get('/status', async (req, res) => {
    try {
        const { storeId } = req.query;
        const status = await (0, zapiService_1.getInstanceStatus)(storeId || null);
        res.json(status);
    }
    catch (err) {
        res.status(503).json({ error: err.message, connected: false });
    }
});
exports.default = router;
//# sourceMappingURL=zapi.js.map