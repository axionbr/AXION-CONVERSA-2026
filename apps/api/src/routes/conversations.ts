import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendTextMessage } from '../services/zapiService';
import { emitNewMessage, emitConversationUpdate } from '../socket';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

const convInclude = {
  contact: true,
  lead: { include: { tags: { include: { tag: true } } } },
  assignedUser: { select: { id: true, name: true } },
  store: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { status, mode, storeId, assignedUserId, noReply, page = '1', limit = '20' } = req.query;
    const where: any = {};
    if (status) where.status = status;
    if (mode) where.mode = mode;
    if (storeId) where.storeId = storeId;
    if (assignedUserId) where.assignedUserId = assignedUserId;
    if (noReply === 'true') {
      const threshold = new Date(Date.now() - 30 * 60 * 1000);
      where.lastMessageAt = { lt: threshold };
      where.status = { in: ['ABERTA', 'AGUARDANDO'] };
    }
    if (req.user!.role === 'VENDEDOR' || req.user!.role === 'ATENDENTE') {
      where.storeId = req.user!.storeId;
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: { lastMessageAt: 'desc' },
        include: convInclude,
      }),
      prisma.conversation.count({ where }),
    ]);
    res.json({ conversations, total });
  } catch (err) { next(err); }
});

router.get('/live', async (req: AuthRequest, res, next) => {
  try {
    const where: any = { status: { in: ['ABERTA', 'EM_ATENDIMENTO', 'AGUARDANDO'] } };
    if (req.user!.role === 'VENDEDOR' || req.user!.role === 'ATENDENTE') {
      where.storeId = req.user!.storeId;
    }
    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: convInclude,
    });
    res.json(conversations);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { ...convInclude, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json(conversation);
  } catch (err) { next(err); }
});

router.get('/:id/messages', async (req, res, next) => {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(messages);
  } catch (err) { next(err); }
});

router.post('/:id/send', async (req: AuthRequest, res, next) => {
  try {
    const { content } = req.body;
    const conv = await prisma.conversation.findUnique({ where: { id: req.params.id }, include: { contact: true } });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    const msg = await prisma.message.create({
      data: { conversationId: req.params.id, direction: 'OUTBOUND', type: 'TEXT', content },
    });

    await prisma.conversation.update({ where: { id: req.params.id }, data: { lastMessageAt: new Date() } });

    await sendTextMessage(conv.contact.phone, content, conv.storeId).catch((e: any) =>
      console.error('Send error:', e.message)
    );

    emitNewMessage(req.params.id, {
      id: msg.id, conversationId: req.params.id, direction: 'OUTBOUND',
      type: 'TEXT', content, createdAt: msg.createdAt.toISOString(),
    });

    res.json(msg);
  } catch (err) { next(err); }
});

router.post('/:id/assume', async (req: AuthRequest, res, next) => {
  try {
    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { assignedUserId: req.user!.id, mode: 'HUMANO', aiEnabled: false, status: 'EM_ATENDIMENTO' },
    });
    emitConversationUpdate(req.params.id, { mode: 'HUMANO', assignedUserId: req.user!.id });
    res.json(conv);
  } catch (err) { next(err); }
});

router.post('/:id/pause-ai', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { aiEnabled: false },
    });
    emitConversationUpdate(req.params.id, { aiEnabled: false });
    res.json(conv);
  } catch (err) { next(err); }
});

router.post('/:id/resume-ai', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { aiEnabled: true, mode: 'IA_AUTOMATICA' },
    });
    emitConversationUpdate(req.params.id, { aiEnabled: true, mode: 'IA_AUTOMATICA' });
    res.json(conv);
  } catch (err) { next(err); }
});

router.post('/:id/transfer', async (req, res, next) => {
  try {
    const { userId } = req.body;
    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { assignedUserId: userId, mode: 'HUMANO', aiEnabled: false },
    });
    emitConversationUpdate(req.params.id, { assignedUserId: userId, mode: 'HUMANO' });
    res.json(conv);
  } catch (err) { next(err); }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const conv = await prisma.conversation.update({ where: { id: req.params.id }, data: { status } });
    emitConversationUpdate(req.params.id, { status });
    res.json(conv);
  } catch (err) { next(err); }
});

export default router;
