import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

function strip(user: any) {
  if (!user) return user;
  const { password, ...safe } = user;
  return safe;
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const user = await prisma.user.findUnique({ where: { email }, include: { store: true } });
    if (!user || !user.active) return res.status(401).json({ error: 'Credenciais inválidas' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, storeId: user.storeId },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn } as any
    );

    res.json({ token, user: strip(user) });
  } catch (err) { next(err); }
});

router.get('/me', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { store: true },
    });
    res.json(strip(user));
  } catch (err) { next(err); }
});

export default router;
