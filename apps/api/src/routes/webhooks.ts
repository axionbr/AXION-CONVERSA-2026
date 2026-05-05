import { Router } from 'express';
import { config } from '../config';
import { processZapiWebhook } from '../services/webhookProcessor';

const router = Router();

router.post('/zapi', async (req, res) => {
  const secret = req.headers['x-webhook-secret'] || req.headers['x-hub-signature'];
  if (config.webhookSecret && secret !== config.webhookSecret) {
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
});

// Test webhook endpoint
router.post('/zapi/test', async (req, res) => {
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
