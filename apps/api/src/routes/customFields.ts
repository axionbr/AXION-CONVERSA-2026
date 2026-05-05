import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const fields = await prisma.customField.findMany({ orderBy: { name: 'asc' } });
    res.json(fields);
  } catch (err) { next(err); }
});

router.post('/', requireRole('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
  try {
    const field = await prisma.customField.create({ data: req.body });
    res.status(201).json(field);
  } catch (err) { next(err); }
});

router.put('/:id', requireRole('ADMIN', 'DIRETOR', 'GERENTE'), async (req, res, next) => {
  try {
    const field = await prisma.customField.update({ where: { id: req.params.id }, data: req.body });
    res.json(field);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await prisma.customField.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/values', async (req, res, next) => {
  try {
    const { customFieldId, leadId, value } = req.body;
    const val = await prisma.customFieldValue.upsert({
      where: { customFieldId_leadId: { customFieldId, leadId } },
      update: { value },
      create: { customFieldId, leadId, value },
    });
    res.json(val);
  } catch (err) { next(err); }
});

export default router;
