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

router.get('/charts', async (req: AuthRequest, res, next) => {
  try {
    const where: any = {};
    if (req.user!.role === 'VENDEDOR' || req.user!.role === 'ATENDENTE') {
      where.storeId = req.user!.storeId;
    }

    const period = (req.query.period as string) || '7d';
    const now = new Date();
    let startDate: Date;
    let isHourly = false;

    if (period === 'today') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      isHourly = true;
    } else if (period === '30d' || period === 'month') {
      startDate = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);
    }

    const messageWhere: any = { createdAt: { gte: startDate } };
    if (where.storeId) messageWhere.conversation = { storeId: where.storeId };
    const leadWhere: any = where.storeId ? { storeId: where.storeId } : {};

    const [conversationsInPeriod, allConversations, allLeads, messagesInPeriod] = await Promise.all([
      prisma.conversation.findMany({
        where: { ...where, createdAt: { gte: startDate } },
        select: { createdAt: true },
      }),
      prisma.conversation.findMany({ where, select: { status: true } }),
      prisma.lead.findMany({ where: leadWhere, select: { temperature: true } }),
      prisma.message.findMany({ where: messageWhere, select: { direction: true } }),
    ]);

    // Buckets: horas (today) ou dias (7d/30d)
    const buckets: Record<string, number> = {};
    if (isHourly) {
      for (let h = 0; h <= now.getHours(); h++) {
        buckets[`${String(h).padStart(2, '0')}:00`] = 0;
      }
      conversationsInPeriod.forEach(c => {
        const key = `${String(new Date(c.createdAt).getHours()).padStart(2, '0')}:00`;
        if (key in buckets) buckets[key]++;
      });
    } else {
      const days = period === '30d' || period === 'month' ? 30 : 7;
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        buckets[d.toISOString().slice(0, 10)] = 0;
      }
      conversationsInPeriod.forEach(c => {
        const key = new Date(c.createdAt).toISOString().slice(0, 10);
        if (key in buckets) buckets[key]++;
      });
    }

    const conversationsByDay = Object.entries(buckets).map(([date, count]) => ({ date, count }));

    // Distribuição de status
    const statusMap: Record<string, number> = {};
    allConversations.forEach(c => {
      statusMap[c.status] = (statusMap[c.status] || 0) + 1;
    });
    const statusDistribution = Object.entries(statusMap)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    // Temperatura dos leads
    const tempOrder = ['FRIO', 'MORNO', 'QUENTE', 'URGENTE'];
    const tempMap: Record<string, number> = { FRIO: 0, MORNO: 0, QUENTE: 0, URGENTE: 0 };
    allLeads.forEach(l => { if (l.temperature in tempMap) tempMap[l.temperature]++; });
    const leadTemperature = tempOrder.map(t => ({ temperature: t, count: tempMap[t] }));

    // Mensagens inbound vs outbound
    let inbound = 0, outbound = 0;
    messagesInPeriod.forEach(m => {
      if (m.direction === 'INBOUND') inbound++;
      else outbound++;
    });

    res.json({
      conversationsByDay,
      statusDistribution,
      leadTemperature,
      messagesByDirection: { inbound, outbound },
    });
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
