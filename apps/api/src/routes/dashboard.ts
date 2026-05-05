import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/metrics', async (req: AuthRequest, res, next) => {
  try {
    const where: any = {};
    if (req.user!.role === 'VENDEDOR' || req.user!.role === 'ATENDENTE') {
      where.storeId = req.user!.storeId;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalConversations,
      activeConversations,
      awaitingHuman,
      resolvedToday,
      newLeadsToday,
      hotLeads,
      aiHandled,
    ] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.count({ where: { ...where, status: { in: ['ABERTA', 'EM_ATENDIMENTO'] } } }),
      prisma.conversation.count({ where: { ...where, status: 'AGUARDANDO', mode: 'HUMANO' } }),
      prisma.conversation.count({ where: { ...where, status: 'RESOLVIDA', updatedAt: { gte: today } } }),
      prisma.lead.count({ where: { ...where, createdAt: { gte: today } } }),
      prisma.lead.count({ where: { ...where, temperature: { in: ['QUENTE', 'URGENTE'] } } }),
      prisma.conversation.count({ where: { ...where, mode: 'IA_AUTOMATICA', aiEnabled: true } }),
    ]);

    res.json({
      totalConversations,
      activeConversations,
      awaitingHuman,
      resolvedToday,
      newLeadsToday,
      hotLeads,
      avgResponseTime: 4.2,
      aiHandled,
    });
  } catch (err) { next(err); }
});

router.get('/live-conversations', async (req: AuthRequest, res, next) => {
  try {
    const where: any = { status: { in: ['ABERTA', 'EM_ATENDIMENTO', 'AGUARDANDO'] } };
    if (req.user!.role === 'VENDEDOR' || req.user!.role === 'ATENDENTE') {
      where.storeId = req.user!.storeId;
    }

    const { storeId, assignedUserId, temperature, noReply } = req.query;
    if (storeId) where.storeId = storeId;
    if (assignedUserId) where.assignedUserId = assignedUserId;
    if (temperature) where.lead = { temperature };
    if (noReply === 'true') {
      const threshold = new Date(Date.now() - 30 * 60 * 1000);
      where.lastMessageAt = { lt: threshold };
    }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: {
        contact: true,
        lead: { include: { tags: { include: { tag: true } } } },
        assignedUser: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });

    res.json(conversations);
  } catch (err) { next(err); }
});

router.get('/automation-logs', async (req, res, next) => {
  try {
    const logs = await prisma.automationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { conversation: true, lead: true },
    });
    res.json(logs);
  } catch (err) { next(err); }
});

export default router;
