import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth';
import { generateAiResponse } from '../services/aiService';

const router = Router();
const prisma = new PrismaClient();

const SAFE_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function safeClaudeModel(model: unknown): string {
  const m = typeof model === 'string' ? model.trim() : '';
  return m.startsWith('claude-') ? m : SAFE_DEFAULT_MODEL;
}

router.use(authenticate);

// GET /ai/config — lista configurações de IA salvas no banco
router.get('/config', async (_req, res, next) => {
  try {
    const configs = await prisma.aiConfig.findMany({ include: { store: true } });
    // Sanitizar: nunca retornar provider='openai' — já que o sistema usa só Anthropic
    const safe = configs.map(c => ({
      ...c,
      provider: 'anthropic',
      model:    safeClaudeModel(c.model),
    }));
    res.json(safe);
  } catch (err) { next(err); }
});

// POST /ai/config — salva ou atualiza configuração de IA
// Sempre força provider='anthropic' e valida modelo Claude.
// Corrige o bug de upsert com storeId undefined.
router.post('/config', requireRole('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
  try {
    const { storeId: rawStoreId, model: rawModel, ...rest } = req.body;

    // storeId seguro: null se vazio/undefined
    const storeId = rawStoreId && typeof rawStoreId === 'string' && rawStoreId.trim()
      ? rawStoreId.trim()
      : null;

    const data = {
      ...rest,
      provider: 'anthropic',                // SEMPRE Anthropic
      model:    safeClaudeModel(rawModel),  // SEMPRE modelo Claude válido
    };

    let aiConfig;

    if (storeId) {
      // Config por loja — upsert seguro (storeId é string não-vazia)
      aiConfig = await prisma.aiConfig.upsert({
        where:  { storeId },
        update: data,
        create: { storeId, ...data },
      });
    } else {
      // Config global (sem loja) — busca por storeId null e atualiza, ou cria
      const existing = await prisma.aiConfig.findFirst({ where: { storeId: null } });
      if (existing) {
        aiConfig = await prisma.aiConfig.update({ where: { id: existing.id }, data });
      } else {
        aiConfig = await prisma.aiConfig.create({ data });
      }
    }

    console.log(`[CONFIG_AI] Salvo | provider: ${aiConfig.provider} | modelo: ${aiConfig.model} | loja: ${storeId ?? 'global'}`);
    res.json(aiConfig);
  } catch (err) { next(err); }
});

// POST /ai/test — testa a IA com uma mensagem
router.post('/test', async (req, res, next) => {
  try {
    const { message, storeId } = req.body;
    if (!message) return res.status(400).json({ error: 'message obrigatório' });
    const reply = await generateAiResponse('test', [{ role: 'user', content: message }], storeId);
    res.json({ reply });
  } catch (err) { next(err); }
});

// POST /ai/classify — classifica intenção e temperatura por palavras-chave
router.post('/classify', async (req, res, next) => {
  try {
    const { classifyIntentAndTemperature } = await import('../services/aiService');
    const result = await classifyIntentAndTemperature(req.body.text || '');
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
