"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const socket_1 = require("./socket");
const routes_1 = __importDefault(require("./routes"));
const errorHandler_1 = require("./middleware/errorHandler");
// ─── Validação de segurança no startup ───────────────────────────────────────
(0, config_1.validateProductionConfig)();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
(0, socket_1.initSocket)(server);
app.use((0, helmet_1.default)({ crossOriginEmbedderPolicy: false }));
app.use((0, cors_1.default)({ origin: config_1.config.frontendUrl, credentials: true }));
// Morgan silenciado em produção para não poluir logs com cada requisição
app.use((0, morgan_1.default)(config_1.config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use('/api', (0, express_rate_limit_1.default)({ windowMs: 60000, max: 300, standardHeaders: true, legacyHeaders: false }), routes_1.default);
app.get('/health', (_, res) => res.json({
    status: 'ok',
    version: '1.0.0',
    ts: new Date(),
    env: config_1.config.nodeEnv,
}));
app.use(errorHandler_1.errorHandler);
server.listen(config_1.config.port, () => {
    const divider = '─'.repeat(50);
    console.log(divider);
    console.log(`🚀 AXION API | porta: ${config_1.config.port} | env: ${config_1.config.nodeEnv}`);
    console.log(`   Frontend URL : ${config_1.config.frontendUrl}`);
    console.log(`   AI Provider  : ${config_1.config.aiProvider} | modelo: ${config_1.config.aiModel}`);
    console.log(`   Anthropic    : ${config_1.config.anthropicApiKey ? '✓ configurado' : '✗ não configurado'}`);
    console.log(`   OpenAI       : ${config_1.config.openaiApiKey ? '✓ configurado' : '✗ não configurado'}`);
    console.log(`   Z-API        : ${config_1.config.zapi.instanceId ? `✓ instância: ${config_1.config.zapi.instanceId}` : '✗ não configurado'}`);
    console.log(`   Webhook Sec  : ${config_1.config.webhookSecret ? '✓ ativo' : '⚠ sem secret (aberto)'}`);
    console.log(`   JWT Secret   : ${config_1.config.jwtSecret === 'axion-dev-insecure-2026' ? '⚠ padrão de dev' : '✓ personalizado'}`);
    console.log(divider);
});
exports.default = app;
//# sourceMappingURL=index.js.map