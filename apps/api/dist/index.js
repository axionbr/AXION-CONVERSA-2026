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
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
(0, socket_1.initSocket)(server);
app.use((0, helmet_1.default)({ crossOriginEmbedderPolicy: false }));
app.use((0, cors_1.default)({ origin: config_1.config.frontendUrl, credentials: true }));
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use('/api', (0, express_rate_limit_1.default)({ windowMs: 60000, max: 300, standardHeaders: true, legacyHeaders: false }), routes_1.default);
app.get('/health', (_, res) => res.json({ status: 'ok', version: '1.0.0', ts: new Date() }));
app.use(errorHandler_1.errorHandler);
server.listen(config_1.config.port, () => {
    console.log(`🚀 AXION API running on http://localhost:${config_1.config.port}`);
    console.log(`   Environment: ${config_1.config.nodeEnv}`);
    console.log(`   AI Provider: ${config_1.config.aiProvider}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map