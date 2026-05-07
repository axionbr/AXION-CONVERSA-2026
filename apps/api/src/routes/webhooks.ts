import { Router, Request, Response } from 'express';
import { config } from '../config';
import { processZapiWebhook } from '../services/webhookProcessor';

const router = Router();

function validateSecret(req: any): boolean {
  const { webhookSecret, nodeEnv } = config;

  // Sem secret configurado: libera em dev, bloqueia em produção
  if (!webhookSecret) return nodeEnv !== 'production';

  // Aceita o segredo em qualquer uma das quatro formas suportadas pela Z-API
  const candidate =
    (req.headers['x-webhook-secret'] as string) ||
    (req.headers['x-zapi-secret'] as string) ||
    (req.query?.secret as string) ||
    (req.body?.secret as string);

  return candidate === webhookSecret;
}

function handleWebhook(req: any, res: any) {
  if (!validateSecret(req)) {
    return res.status(403).json({ error: 'Invalid webhook secret' });
  }
  res.status(200).json({ received: true });
  setImmediate(async () => {
    try {
      await processZapiWebhook(req.body);
    } catch (err: any) {
      console.error('Webhook error:', err.message);
    }
  });
}

// Endpoint principal
router.post('/zapi', handleWebhook);

// Alias solicitado: /received
router.post('/zapi/received', handleWebhook);

// Endpoint de teste sem autenticação de secret
router.post('/zapi/test', (req: Request, res: Response) => {
  res.status(200).json({ received: true });
  setImmediate(async () => {
    try {
      await processZapiWebhook(req.body);
    } catch (err: any) {
      console.error('Test webhook error:', err.message);
    }
  });
});

export default router;
