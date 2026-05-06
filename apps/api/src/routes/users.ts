import { Router, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

function strip(user: any) {
  if (!user) return user;
  const { password, ...safe } = user;
  return safe;
}

router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.query;
    const where: any = {};
    if (storeId) where.storeId = storeId;
    if (req.user!.role !== 'ADMIN' && req.user!.role !== 'DIRETOR') {
      where.storeId = req.user!.storeId;
    }
    const users = await prisma.user.findMany({ where, include: { store: true } });
    res.json(users.map(strip));
  } catch (err) { next(err); }
});

router.post('/', requireRole('ADMIN', 'DIRETOR', 'GERENTE'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, role, storeId } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, password: hash, role, storeId } });
    res.status(201).json(strip(user));
  } catch (err) { next(err); }
});

router.put('/:id', requireRole('ADMIN', 'DIRETOR', 'GERENTE'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { password, ...data } = req.body;
    const updateData: any = { ...data };
    if (password) updateData.password = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: updateData });
    res.json(strip(user));
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('ADMIN', 'DIRETOR'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
