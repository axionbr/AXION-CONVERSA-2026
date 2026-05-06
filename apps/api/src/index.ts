import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { initSocket } from './socket';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const server = http.createServer(app);

initSocket(server);

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  '/api',
  rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }) as unknown as express.RequestHandler,
  routes
);

app.get('/health', (_, res) => res.json({ status: 'ok', version: '1.0.0', ts: new Date() }));

app.use(errorHandler);

server.listen(config.port, () => {
  console.log(`🚀 AXION API running on http://localhost:${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   AI Provider: ${config.aiProvider}`);
});

export default app;
