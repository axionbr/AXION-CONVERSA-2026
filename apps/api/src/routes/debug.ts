import { Router, Request, Response } from 'express';
import { config } from '../config';
import { sendWhatsAppText } from '../services/outboundWhatsAppService';

const router = Router();

/**
 * POST /api/debug/send-whatsapp-test?secret=<WEBHOOK_SECRET>
 *
 * Rota de diagnóstico: prova que o caminho CRM → Z-API → WhatsApp funciona.
 * Protegida pelo mesmo WEBHOOK_SECRET — nunca exposta sem autenticação.
 * Nunca loga o secret.
 */
router.post('/send-whatsapp-test', async (req: Request, res: Response) => {
  const { webhookSecret } = config;

  // Aceita secret por query, header ou body (mesma convenção do webhook)
  const candidate =
    (req.query?.secret               as string) ||
    (req.headers['x-webhook-secret'] as string) ||
    (req.body?.secret                as string);

  if (!webhookSecret || candidate !== webhookSecret) {
    console.warn(`[DEBUG_WHATSAPP_TEST] Acesso negado | IP: ${req.ip} | candidate presente: ${!!candidate}`);
    return res.status(403).json({ error: 'Secret inválido ou não configurado' });
  }

  const { phone, message } = req.body;

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: '"phone" obrigatório (ex: "5521999999999")' });
  }
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: '"message" obrigatório' });
  }

  console.log(`[DEBUG_WHATSAPP_TEST] Iniciando envio de teste | IP: ${req.ip} | phone: ${phone.replace(/\d/g, '*')}`);

  const result = await sendWhatsAppText({
    conversationId: 'debug-test',
    storeId:        null,   // usa credenciais globais do .env
    phone,
    text:           message,
    source:         'system',
  });

  if (result.ok) {
    console.log(`[DEBUG_WHATSAPP_TEST] Envio OK | phone normalizado: ${result.phone?.replace(/\d{4}(\d+)\d{3}/, '****$2***')}`);
    return res.json({ ok: true, message: 'Mensagem enviada com sucesso', phone: result.phone });
  } else {
    return res.status(502).json({
      ok:         false,
      error:      result.error,
      httpStatus: result.httpStatus,
    });
  }
});

export default router;
