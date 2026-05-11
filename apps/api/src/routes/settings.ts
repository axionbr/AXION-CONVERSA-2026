import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { config } from '../config';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/integrations', async (_req, res, next) => {
  try {
    const zapiConfig = await prisma.zapiConfig.findFirst({ where: { active: true } });
    const zapiOk = !!(zapiConfig?.instanceId && zapiConfig?.token);

    res.json({
      zapi: {
        label: 'Z-API WhatsApp',
        configured: zapiOk,
        detail: zapiOk ? `Instancia: ${zapiConfig!.instanceId}` : 'Nao configurado',
        docsUrl: 'https://developer.z-api.io',
      },
      claude: {
        label: 'Anthropic Claude',
        configured: !!config.anthropicApiKey,
        detail: config.anthropicApiKey ? `Modelo: ${config.aiModel}` : 'ANTHROPIC_API_KEY nao definida',
        docsUrl: 'https://docs.anthropic.com',
      },
      openai: {
        label: 'OpenAI GPT',
        configured: !!config.openaiApiKey,
        detail: config.openaiApiKey ? 'API Key configurada' : 'OPENAI_API_KEY nao definida',
        docsUrl: 'https://platform.openai.com',
      },
      n8n: {
        label: 'N8N Automacao',
        configured: false,
        detail: 'Em breve',
        docsUrl: 'https://n8n.io',
      },
      sheets: {
        label: 'Google Sheets',
        configured: false,
        detail: 'Em breve',
        docsUrl: 'https://developers.google.com/sheets',
      },
      calendar: {
        label: 'Google Calendar',
        configured: false,
        detail: 'Em breve',
        docsUrl: 'https://developers.google.com/calendar',
      },
      erp: {
        label: 'ERP Tecle Motos',
        configured: false,
        detail: 'Integracao futura',
        docsUrl: '',
      },
      asaas: {
        label: 'Asaas Pagamentos',
        configured: false,
        detail: 'Em breve',
        docsUrl: 'https://asaas.com/developers',
      },
    });
  } catch (err) { next(err); }
});

export default router;
