import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const stores = await prisma.store.findMany({ where: { active: true }, include: { _count: { select: { users: true, leads: true } } } });
    res.json(stores);
  } catch (err) { next(err); }
});

router.post('/', requireRole('ADMIN', 'DIRETOR'), async (req, res, next) => {
  try {
    const store = await prisma.store.create({ data: req.body });
    res.status(201).json(store);
  } catch (err) { next(err); }
});

router.put('/:id', requireRole('ADMIN', 'DIRETOR'), async (req, res, next) => {
  try {
    const store = await prisma.store.update({ where: { id: req.params.id }, data: req.body });
    res.json(store);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await prisma.store.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
