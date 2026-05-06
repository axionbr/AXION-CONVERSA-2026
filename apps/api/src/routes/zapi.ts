import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth';
import { getInstanceStatus } from '../services/zapiService';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const configs = await prisma.zapiConfig.findMany({ include: { store: true } });
    res.json(configs.map((c) => ({ ...c, token: '***', clientToken: '***' })));
  } catch (err) { next(err); }
});

router.post('/config', requireRole('ADMIN', 'DIRETOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId, ...data } = req.body;
    const config = await prisma.zapiConfig.upsert({
      where: { storeId: storeId || undefined },
      update: data,
      create: { storeId, ...data },
    });
    res.json({ ...config, token: '***', clientToken: '***' });
  } catch (err) { next(err); }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const { storeId } = req.query;
    const status = await getInstanceStatus(storeId as string || null);
    res.json(status);
  } catch (err: any) {
    res.status(503).json({ error: err.message, connected: false });
  }
});

export default router;
