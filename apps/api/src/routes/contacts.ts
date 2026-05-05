import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { search, page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
      ];
    }
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({ where, skip, take: parseInt(limit as string), orderBy: { createdAt: 'desc' } }),
      prisma.contact.count({ where }),
    ]);
    res.json({ contacts, total, page: parseInt(page as string) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: { leads: true, conversations: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json(contact);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const contact = await prisma.contact.create({ data: req.body });
    res.status(201).json(contact);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data: req.body });
    res.json(contact);
  } catch (err) { next(err); }
});

export default router;
