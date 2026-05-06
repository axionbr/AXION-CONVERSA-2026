"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const aiService_1 = require("../services/aiService");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
router.get('/config', async (req, res, next) => {
    try {
        const configs = await prisma.aiConfig.findMany({ include: { store: true } });
        res.json(configs);
    }
    catch (err) {
        next(err);
    }
});
router.post('/config', (0, auth_1.requireRole)('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
    try {
        const { storeId, ...data } = req.body;
        const config = await prisma.aiConfig.upsert({
            where: { storeId: storeId || undefined },
            update: data,
            create: { storeId, ...data },
        });
        res.json(config);
    }
    catch (err) {
        next(err);
    }
});
router.post('/test', async (req, res, next) => {
    try {
        const { message, storeId } = req.body;
        const reply = await (0, aiService_1.generateAiResponse)('test', [{ role: 'user', content: message }], storeId);
        res.json({ reply });
    }
    catch (err) {
        next(err);
    }
});
router.post('/classify', async (req, res, next) => {
    try {
        const { classifyIntentAndTemperature } = await Promise.resolve().then(() => __importStar(require('../services/aiService')));
        const result = await classifyIntentAndTemperature(req.body.text);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=ai.js.map