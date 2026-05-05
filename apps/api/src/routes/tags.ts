import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const tags = await prisma.tag.findMany({ include: { _count: { select: { leads: true } } }, orderBy: { name: 'asc' } });
    res.json(tags);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const tag = await prisma.tag.create({ data: req.body });
    res.status(201).json(tag);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const tag = await prisma.tag.update({ where: { id: req.params.id }, data: req.body });
    res.json(tag);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.tag.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
