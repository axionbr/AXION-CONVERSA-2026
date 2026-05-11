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
        res.json({
            zapi: {
                label: 'Z-API WhatsApp',
                configured: zapiOk,
                detail: zapiOk ? `Instancia: ${zapiConfig.instanceId}` : 'Nao configurado',
                docsUrl: 'https://developer.z-api.io',
            },
            claude: {
                label: 'Anthropic Claude',
                configured: !!config_1.config.anthropicApiKey,
                detail: config_1.config.anthropicApiKey ? `Modelo: ${config_1.config.aiModel}` : 'ANTHROPIC_API_KEY nao definida',
                docsUrl: 'https://docs.anthropic.com',
            },
            openai: {
                label: 'OpenAI GPT',
                configured: !!config_1.config.openaiApiKey,
                detail: config_1.config.openaiApiKey ? 'API Key configurada' : 'OPENAI_API_KEY nao definida',
                docsUrl: 'https://platform.openai.com',
            },
            n8n: {
                label: 'N8N Automacao',
                configured: false,
                detail: 'Em breve',
                docsUrl: 'https://n8n.io',
            },
            sheets: {
                label: 'Google Sheets',
                configured: false,
                detail: 'Em breve',
                docsUrl: 'https://developers.google.com/sheets',
            },
            calendar: {
                label: 'Google Calendar',
                configured: false,
                detail: 'Em breve',
                docsUrl: 'https://developers.google.com/calendar',
            },
            erp: {
                label: 'ERP Tecle Motos',
                configured: false,
                detail: 'Integracao futura',
                docsUrl: '',
            },
            asaas: {
                label: 'Asaas Pagamentos',
                configured: false,
                detail: 'Em breve',
                docsUrl: 'https://asaas.com/developers',
            },
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=settings.js.map