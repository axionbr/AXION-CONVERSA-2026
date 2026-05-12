import dotenv from 'dotenv';
dotenv.config();

// JWT_SECRET: obrigatório em produção, usa fallback de dev em outros ambientes
const jwtSecret = process.env.JWT_SECRET || 'axion-dev-insecure-2026';

export const config = {
  port:        parseInt(process.env.PORT || '3001'),
  nodeEnv:     process.env.NODE_ENV || 'development',
  jwtSecret,
  jwtExpiresIn:    process.env.JWT_EXPIRES_IN    || '7d',
  frontendUrl:     process.env.FRONTEND_URL      || 'http://localhost:5173',
  openaiApiKey:    process.env.OPENAI_API_KEY    || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  aiProvider:      (process.env.AI_PROVIDER || 'anthropic') as 'openai' | 'anthropic',
  aiModel:         process.env.AI_MODEL          || 'claude-haiku-4-5-20251001',
  zapi: {
    instanceId:  process.env.ZAPI_INSTANCE_ID  || '',
    token:       process.env.ZAPI_TOKEN        || '',
    clientToken: process.env.ZAPI_CLIENT_TOKEN || '',
    baseUrl:     process.env.ZAPI_BASE_URL     || 'https://api.z-api.io',
  },
  webhookSecret: process.env.WEBHOOK_SECRET || '',
};

// ─── Validação de segurança para produção ────────────────────────────────────
export function validateProductionConfig(): void {
  const isProduction = config.nodeEnv === 'production';

  if (isProduction && config.jwtSecret === 'axion-dev-insecure-2026') {
    console.error('[SEGURANÇA CRÍTICA] JWT_SECRET não está definido no .env!');
    console.error('[SEGURANÇA CRÍTICA] Qualquer pessoa pode forjar tokens de autenticação.');
    console.error('[SEGURANÇA CRÍTICA] Defina JWT_SECRET=<segredo-forte> no .env e reinicie.');
    process.exit(1);
  }

  if (isProduction && !config.webhookSecret) {
    console.warn('[SEGURANÇA] WEBHOOK_SECRET não definido — webhook Z-API está aberto sem validação.');
    console.warn('[SEGURANÇA] Recomendado: defina WEBHOOK_SECRET no .env para proteger o endpoint.');
  }

  if (isProduction && !config.anthropicApiKey) {
    console.warn('[IA] ANTHROPIC_API_KEY não definida — IA usará classificação por palavras-chave apenas (modo offline).');
    console.warn('[IA] Configure ANTHROPIC_API_KEY no .env para ativar o motor comercial Claude.');
  }
}
