"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const webhookProcessor_1 = require("../services/webhookProcessor");
const router = (0, express_1.Router)();
// ─── Validação do secret do webhook ──────────────────────────────────────────
// Z-API suporta 4 formas de enviar o secret: header, query ou body
function validateSecret(req) {
    const { webhookSecret, nodeEnv } = config_1.config;
    // Sem secret configurado: libera em dev, bloqueia em produção
    if (!webhookSecret)
        return nodeEnv !== 'production';
    const candidate = req.headers['x-webhook-secret'] ||
        req.headers['x-zapi-secret'] ||
        req.query?.secret ||
        req.body?.secret;
    return candidate === webhookSecret;
}
// ─── Handler principal (idempotente: responde 200 e processa async) ───────────
function handleWebhook(req, res) {
    if (!validateSecret(req)) {
        console.warn('[WEBHOOK] Acesso negado — secret inválido ou ausente | IP:', req.ip);
        return res.status(403).json({ error: 'Invalid webhook secret' });
    }
    // Responde imediatamente para evitar timeout/retry da Z-API
    res.status(200).json({ received: true });
    setImmediate(async () => {
        try {
            await (0, webhookProcessor_1.processZapiWebhook)(req.body);
        }
        catch (err) {
            console.error('[WEBHOOK_ERROR] Falha no processamento assíncrono:', err.message);
        }
    });
}
// ─── Endpoint principal (configurado no painel Z-API) ─────────────────────────
router.post('/zapi', handleWebhook);
// ─── Alias /received (alternativa de URL para o painel Z-API) ────────────────
router.post('/zapi/received', handleWebhook);
// ─── Endpoint de teste (útil para debug local) ────────────────────────────────
// Em produção: exige WEBHOOK_SECRET para evitar injeção de payloads falsos
router.post('/zapi/test', (req, res) => {
    if (config_1.config.nodeEnv === 'production' && !validateSecret(req)) {
        console.warn('[WEBHOOK] /test bloqueado em produção sem secret válido | IP:', req.ip);
        return res.status(403).json({
            error: 'Endpoint /test requer WEBHOOK_SECRET em produção',
            hint: 'Adicione ?secret=<WEBHOOK_SECRET> na URL ou header x-webhook-secret',
        });
    }
    console.log('[WEBHOOK] /test chamado | env:', config_1.config.nodeEnv);
    res.status(200).json({ received: true, note: 'test endpoint' });
    setImmediate(async () => {
        try {
            await (0, webhookProcessor_1.processZapiWebhook)(req.body);
        }
        catch (err) {
            console.error('[WEBHOOK_ERROR] /test falhou:', err.message);
        }
    });
});
exports.default = router;
//# sourceMappingURL=webhooks.js.map