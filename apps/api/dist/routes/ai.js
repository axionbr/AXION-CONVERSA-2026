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
const SAFE_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
function safeClaudeModel(model) {
    const m = typeof model === 'string' ? model.trim() : '';
    return m.startsWith('claude-') ? m : SAFE_DEFAULT_MODEL;
}
router.use(auth_1.authenticate);
// GET /ai/config — lista configurações de IA salvas no banco
router.get('/config', async (_req, res, next) => {
    try {
        const configs = await prisma.aiConfig.findMany({ include: { store: true } });
        // Sanitizar: nunca retornar provider='openai' — já que o sistema usa só Anthropic
        const safe = configs.map(c => ({
            ...c,
            provider: 'anthropic',
            model: safeClaudeModel(c.model),
        }));
        res.json(safe);
    }
    catch (err) {
        next(err);
    }
});
// POST /ai/config — salva ou atualiza configuração de IA
// Sempre força provider='anthropic' e valida modelo Claude.
// Corrige o bug de upsert com storeId undefined.
router.post('/config', (0, auth_1.requireRole)('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
    try {
        const { storeId: rawStoreId, model: rawModel, ...rest } = req.body;
        // storeId seguro: null se vazio/undefined
        const storeId = rawStoreId && typeof rawStoreId === 'string' && rawStoreId.trim()
            ? rawStoreId.trim()
            : null;
        const data = {
            ...rest,
            provider: 'anthropic', // SEMPRE Anthropic
            model: safeClaudeModel(rawModel), // SEMPRE modelo Claude válido
        };
        let aiConfig;
        if (storeId) {
            // Config por loja — upsert seguro (storeId é string não-vazia)
            aiConfig = await prisma.aiConfig.upsert({
                where: { storeId },
                update: data,
                create: { storeId, ...data },
            });
        }
        else {
            // Config global (sem loja) — busca por storeId null e atualiza, ou cria
            const existing = await prisma.aiConfig.findFirst({ where: { storeId: null } });
            if (existing) {
                aiConfig = await prisma.aiConfig.update({ where: { id: existing.id }, data });
            }
            else {
                aiConfig = await prisma.aiConfig.create({ data });
            }
        }
        console.log(`[CONFIG_AI] Salvo | provider: ${aiConfig.provider} | modelo: ${aiConfig.model} | loja: ${storeId ?? 'global'}`);
        res.json(aiConfig);
    }
    catch (err) {
        next(err);
    }
});
// POST /ai/test — testa a IA com uma mensagem
router.post('/test', async (req, res, next) => {
    try {
        const { message, storeId } = req.body;
        if (!message)
            return res.status(400).json({ error: 'message obrigatório' });
        const reply = await (0, aiService_1.generateAiResponse)('test', [{ role: 'user', content: message }], storeId);
        res.json({ reply });
    }
    catch (err) {
        next(err);
    }
});
// POST /ai/classify — classifica intenção e temperatura por palavras-chave
router.post('/classify', async (req, res, next) => {
    try {
        const { classifyIntentAndTemperature } = await Promise.resolve().then(() => __importStar(require('../services/aiService')));
        const result = await classifyIntentAndTemperature(req.body.text || '');
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=ai.js.map