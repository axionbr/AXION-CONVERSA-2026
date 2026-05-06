"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const webhookProcessor_1 = require("../services/webhookProcessor");
const router = (0, express_1.Router)();
function validateSecret(req) {
    if (!config_1.config.webhookSecret)
        return true;
    const secret = req.headers['x-webhook-secret'] || req.headers['x-hub-signature'];
    return secret === config_1.config.webhookSecret;
}
function handleWebhook(req, res) {
    if (!validateSecret(req)) {
        return res.status(403).json({ error: 'Invalid webhook secret' });
    }
    res.status(200).json({ received: true });
    setImmediate(async () => {
        try {
            await (0, webhookProcessor_1.processZapiWebhook)(req.body);
        }
        catch (err) {
            console.error('Webhook error:', err.message);
        }
    });
}
// Endpoint principal
router.post('/zapi', handleWebhook);
// Alias solicitado: /received
router.post('/zapi/received', handleWebhook);
// Endpoint de teste sem autenticação de secret
router.post('/zapi/test', (req, res) => {
    res.status(200).json({ received: true });
    setImmediate(async () => {
        try {
            await (0, webhookProcessor_1.processZapiWebhook)(req.body);
        }
        catch (err) {
            console.error('Test webhook error:', err.message);
        }
    });
});
exports.default = router;
//# sourceMappingURL=webhooks.js.map