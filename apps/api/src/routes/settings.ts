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
    const zapiOk     = !!(zapiConfig?.instanceId && zapiConfig?.token);

    // Modelo efetivo: prioriza o salvo na AiConfig global; fallback ao env
    const aiConfig       = await prisma.aiConfig.findFirst({ where: { storeId: null } });
    const effectiveModel = aiConfig?.model || config.aiModel;
    const isClaudeModel  = effectiveModel.startsWith('claude-');
    const claudeOk       = !!config.anthropicApiKey;

    res.json({
      claude: {
        label:     'Anthropic Claude',
        configured: claudeOk,
        detail:    claudeOk
          ? `Modelo: ${isClaudeModel ? effectiveModel : 'claude-haiku-4-5-20251001'}`
          : 'ANTHROPIC_API_KEY não definida no .env',
        docsUrl: 'https://docs.anthropic.com',
      },
      zapi: {
        label:     'Z-API WhatsApp',
        configured: zapiOk,
        detail:    zapiOk ? `Instância: ${zapiConfig!.instanceId}` : 'Não configurado',
        docsUrl: 'https://developer.z-api.io',
      },
    });
  } catch (err) { next(err); }
});

export default router;
