import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config, validateProductionConfig } from './config';
import { initSocket } from './socket';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

// ─── Validação de segurança no startup ───────────────────────────────────────
validateProductionConfig();

const app    = express();
const server = http.createServer(app);

initSocket(server);

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: config.frontendUrl, credentials: true }));
// Morgan silenciado em produção para não poluir logs com cada requisição
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  '/api',
  rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }) as unknown as express.RequestHandler,
  routes
);

app.get('/health', (_, res) => res.json({
  status:  'ok',
  version: '1.0.0',
  ts:      new Date(),
  env:     config.nodeEnv,
}));

app.use(errorHandler);

server.listen(config.port, () => {
  const divider = '─'.repeat(50);
  console.log(divider);
  console.log(`🚀 AXION API | porta: ${config.port} | env: ${config.nodeEnv}`);
  console.log(`   Frontend URL : ${config.frontendUrl}`);
  console.log(`   AI Provider  : ${config.aiProvider} | modelo: ${config.aiModel}`);
  console.log(`   Anthropic    : ${config.anthropicApiKey ? '✓ configurado' : '✗ não configurado'}`);
  console.log(`   OpenAI       : ${config.openaiApiKey    ? '✓ configurado' : '✗ não configurado'}`);
  console.log(`   Z-API        : ${config.zapi.instanceId ? `✓ instância: ${config.zapi.instanceId}` : '✗ não configurado'}`);
  console.log(`   Webhook Sec  : ${config.webhookSecret   ? '✓ ativo' : '⚠ sem secret (aberto)'}`);
  console.log(`   JWT Secret   : ${config.jwtSecret === 'axion-dev-insecure-2026' ? '⚠ padrão de dev' : '✓ personalizado'}`);
  console.log(divider);
});

export default app;
