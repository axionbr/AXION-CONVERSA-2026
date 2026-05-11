import { Router, Request, Response } from 'express';
import { config } from '../config';
import { processZapiWebhook } from '../services/webhookProcessor';

const router = Router();

// ─── Validação do secret do webhook ──────────────────────────────────────────
// Z-API suporta 4 formas de enviar o secret: header, query ou body
function validateSecret(req: Request): boolean {
  const { webhookSecret, nodeEnv } = config;

  // Sem secret configurado: libera em dev, bloqueia em produção
  if (!webhookSecret) return nodeEnv !== 'production';

  const candidate =
    (req.headers['x-webhook-secret'] as string) ||
    (req.headers['x-zapi-secret']    as string) ||
    (req.query?.secret               as string) ||
    (req.body?.secret                as string);

  return candidate === webhookSecret;
}

// ─── Handler principal (idempotente: responde 200 e processa async) ───────────
function handleWebhook(req: Request, res: Response) {
  if (!validateSecret(req)) {
    console.warn('[WEBHOOK] Acesso negado — secret inválido ou ausente | IP:', req.ip);
    return res.status(403).json({ error: 'Invalid webhook secret' });
  }

  // Responde imediatamente para evitar timeout/retry da Z-API
  res.status(200).json({ received: true });

  setImmediate(async () => {
    try {
      await processZapiWebhook(req.body);
    } catch (err: any) {
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
router.post('/zapi/test', (req: Request, res: Response) => {
  if (config.nodeEnv === 'production' && !validateSecret(req)) {
    console.warn('[WEBHOOK] /test bloqueado em produção sem secret válido | IP:', req.ip);
    return res.status(403).json({
      error: 'Endpoint /test requer WEBHOOK_SECRET em produção',
      hint:  'Adicione ?secret=<WEBHOOK_SECRET> na URL ou header x-webhook-secret',
    });
  }

  console.log('[WEBHOOK] /test chamado | env:', config.nodeEnv);
  res.status(200).json({ received: true, note: 'test endpoint' });

  setImmediate(async () => {
    try {
      await processZapiWebhook(req.body);
    } catch (err: any) {
      console.error('[WEBHOOK_ERROR] /test falhou:', err.message);
    }
  });
});

export default router;
