"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
router.get('/integrations', async (_req, res, next) => {
    try {
        const zapiConfig = await prisma.zapiConfig.findFirst({ where: { active: true } });
        const zapiOk = !!(zapiConfig?.instanceId && zapiConfig?.token);
        // Modelo efetivo: prioriza o salvo na AiConfig global; fallback ao env
        const aiConfig = await prisma.aiConfig.findFirst({ where: { storeId: null } });
        const effectiveModel = aiConfig?.model || config_1.config.aiModel;
        const isClaudeModel = effectiveModel.startsWith('claude-');
        const claudeOk = !!config_1.config.anthropicApiKey;
        res.json({
            claude: {
                label: 'Anthropic Claude',
                configured: claudeOk,
                detail: claudeOk
                    ? `Modelo: ${isClaudeModel ? effectiveModel : 'claude-haiku-4-5-20251001'}`
                    : 'ANTHROPIC_API_KEY não definida no .env',
                docsUrl: 'https://docs.anthropic.com',
            },
            zapi: {
                label: 'Z-API WhatsApp',
                configured: zapiOk,
                detail: zapiOk ? `Instância: ${zapiConfig.instanceId}` : 'Não configurado',
                docsUrl: 'https://developer.z-api.io',
            },
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=settings.js.map