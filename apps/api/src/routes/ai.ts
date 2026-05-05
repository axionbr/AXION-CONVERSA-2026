import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth';
import { generateAiResponse } from '../services/aiService';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/config', async (req, res, next) => {
  try {
    const configs = await prisma.aiConfig.findMany({ include: { store: true } });
    res.json(configs);
  } catch (err) { next(err); }
});

router.post('/config', requireRole('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
  try {
    const { storeId, ...data } = req.body;
    const config = await prisma.aiConfig.upsert({
      where: { storeId: storeId || undefined },
      update: data,
      create: { storeId, ...data },
    });
    res.json(config);
  } catch (err) { next(err); }
});

router.post('/test', async (req, res, next) => {
  try {
    const { message, storeId } = req.body;
    const reply = await generateAiResponse('test', [{ role: 'user', content: message }], storeId);
    res.json({ reply });
  } catch (err) { next(err); }
});

router.post('/classify', async (req, res, next) => {
  try {
    const { classifyIntentAndTemperature } = await import('../services/aiService');
    const result = await classifyIntentAndTemperature(req.body.text);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
