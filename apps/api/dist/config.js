"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '3001'),
    nodeEnv: process.env.NODE_ENV || 'development',
    jwtSecret: process.env.JWT_SECRET || 'axion-secret-2026',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    aiProvider: (process.env.AI_PROVIDER || 'openai'),
    aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
    zapi: {
        instanceId: process.env.ZAPI_INSTANCE_ID || '',
        token: process.env.ZAPI_TOKEN || '',
        clientToken: process.env.ZAPI_CLIENT_TOKEN || '',
        baseUrl: process.env.ZAPI_BASE_URL || 'https://api.z-api.io',
    },
    webhookSecret: process.env.WEBHOOK_SECRET || '',
};
//# sourceMappingURL=config.js.map