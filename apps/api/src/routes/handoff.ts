import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  acceptHandoff,
  initiateHandoff,
  checkExpiredNotifications,
} from '../services/handoffService';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// GET /handoff/pending — notificações pendentes do vendedor logado
router.get('/pending', async (req: AuthRequest, res, next) => {
  try {
    const notifications = await prisma.sellerNotification.findMany({
      where: {
        userId: req.user!.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        conversation: {
          include: {
            contact: true,
            lead:    { select: { id: true, temperature: true, source: true, region: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    res.json(notifications);
  } catch (err) { next(err); }
});

// POST /handoff/:notificationId/accept — vendedor aceita o atendimento
router.post('/:notificationId/accept', async (req: AuthRequest, res, next) => {
  try {
    const result = await acceptHandoff(req.params.notificationId, req.user!.id);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ accepted: true });
  } catch (err) { next(err); }
});

// POST /handoff/:conversationId/initiate — iniciar handoff manual (gestor/admin)
router.post('/:conversationId/initiate', async (req: AuthRequest, res, next) => {
  try {
    const conv = await prisma.conversation.findUnique({
      where:   { id: req.params.conversationId },
      include: { lead: true },
    });
    if (!conv)       return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!conv.lead)  return res.status(400).json({ error: 'Conversa sem lead vinculado' });

    await initiateHandoff(req.params.conversationId, {
      id:          conv.lead.id,
      phone:       conv.lead.phone,
      temperature: conv.lead.temperature,
      storeId:     conv.storeId,
      region:      conv.lead.region,
    }, req.body.summary);

    res.json({ initiated: true });
  } catch (err) { next(err); }
});

// POST /handoff/check-expired — forçar verificação de notificações expiradas (cron/admin)
router.post('/check-expired', async (_req, res, next) => {
  try {
    await checkExpiredNotifications();
    res.json({ checked: true });
  } catch (err) { next(err); }
});

export default router;
