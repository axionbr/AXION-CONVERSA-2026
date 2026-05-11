import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { triggerFlowsByEvent } from '../services/flowEngine';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { status, temperature, storeId, assignedUserId, search, page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const where: any = {};
    if (status) where.status = status;
    if (temperature) where.temperature = temperature;
    if (storeId) where.storeId = storeId;
    if (assignedUserId) where.assignedUserId = assignedUserId;
    if (req.user!.role === 'VENDEDOR' || req.user!.role === 'ATENDENTE') {
      where.storeId = req.user!.storeId;
    }
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: [{ priority: 'desc' }, { score: 'desc' }, { updatedAt: 'desc' }],
        include: {
          store: { select: { id: true, name: true } },
          assignedUser: { select: { id: true, name: true } },
          tags: { include: { tag: true } },
          // Última mensagem para o card Kanban
          conversations: {
            orderBy: { createdAt: 'desc' } as const,
            take: 1,
            include: {
              messages: {
                orderBy: { createdAt: 'desc' } as const,
                take: 1,
              },
            },
          },
          // Última análise IA para próxima ação no card Kanban
          automationLogs: {
            where: { type: 'AI_ANALYSIS' },
            orderBy: { createdAt: 'desc' } as const,
            take: 1,
          },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total, page: parseInt(page as string) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        store: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        tags: { include: { tag: true } },
        customValues: { include: { customField: true } },
        conversations: { orderBy: { createdAt: 'desc' }, take: 3 },
        automationLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(lead);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const lead = await prisma.lead.create({
      data: req.body,
      include: { store: true, assignedUser: { select: { id: true, name: true } } },
    });
    res.status(201).json(lead);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        store: true,
        assignedUser: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
      },
    });

    // Log KANBAN_STAGE_CHANGED quando o estágio muda
    if (req.body.kanbanStage) {
      prisma.automationLog.create({
        data: {
          type:        'KANBAN_STAGE_CHANGED',
          description: `Lead "${lead.name}" movido para ${req.body.kanbanStage}`,
          data:        JSON.stringify({ stage: req.body.kanbanStage, leadId: lead.id }),
          leadId:      lead.id,
        },
      }).catch((e: any) => console.error('[KANBAN] Log error:', e.message));

      // Aciona fluxos com trigger KANBAN_STAGE_CHANGED se houver conversa vinculada
      prisma.conversation.findFirst({
        where:  { leadId: lead.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }).then(conv => {
        if (conv) {
          triggerFlowsByEvent('KANBAN_STAGE_CHANGED', req.body.kanbanStage, conv.id, lead.id)
            .catch((e: any) => console.error('[FLOW] KANBAN_STAGE_CHANGED:', e.message));
        }
      }).catch(() => {});
    }

    res.json(lead);
  } catch (err) { next(err); }
});

router.post('/:id/tags', async (req, res, next) => {
  try {
    const { tagId } = req.body;
    await prisma.leadTag.upsert({
      where: { leadId_tagId: { leadId: req.params.id, tagId } },
      update: {},
      create: { leadId: req.params.id, tagId },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id/tags/:tagId', async (req, res, next) => {
  try {
    await prisma.leadTag.delete({ where: { leadId_tagId: { leadId: req.params.id, tagId: req.params.tagId } } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
