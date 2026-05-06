import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendTextMessage } from '../services/zapiService';
import { emitNewMessage, emitConversationUpdate } from '../socket';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

const OPEN_STATUSES = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];

const convInclude = {
  contact: true,
  lead: { include: { tags: { include: { tag: true } } } },
  assignedUser: { select: { id: true, name: true } },
  store: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

// Aplica filtro de loja/usuário conforme role
function applyRoleFilter(where: any, user: any) {
  if (user.role === 'VENDEDOR' || user.role === 'ATENDENTE') {
    where.storeId = user.storeId;
  }
}

// GET /conversations — lista com filtros
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { status, mode, storeId, assignedUserId, noReply, search, page = '1', limit = '20' } = req.query;
    const where: any = {};

    if (status) where.status = status;
    if (mode) where.mode = mode;
    if (storeId) where.storeId = storeId;
    if (assignedUserId) where.assignedUserId = assignedUserId;

    // Filtro de sem resposta: conversas abertas sem resposta há >30 min
    if (noReply === 'true') {
      where.lastMessageAt = { lt: new Date(Date.now() - 30 * 60 * 1000) };
      where.status = { in: OPEN_STATUSES };
    }

    // Busca por nome ou telefone do contato
    if (search && typeof search === 'string' && search.trim()) {
      where.contact = {
        OR: [
          { name: { contains: search.trim() } },
          { phone: { contains: search.trim() } },
        ],
      };
    }

    applyRoleFilter(where, req.user!);

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { lastMessageAt: 'desc' },
        include: convInclude,
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({ conversations, total, page: pageNum, limit: limitNum });
  } catch (err) { next(err); }
});

// GET /conversations/live — conversas abertas em tempo real
router.get('/live', async (req: AuthRequest, res, next) => {
  try {
    const where: any = { status: { in: OPEN_STATUSES } };
    applyRoleFilter(where, req.user!);

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: convInclude,
    });
    res.json(conversations);
  } catch (err) { next(err); }
});

// GET /conversations/:id
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { ...convInclude, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' });
    res.json(conversation);
  } catch (err) { next(err); }
});

// GET /conversations/:id/messages
router.get('/:id/messages', async (req, res, next) => {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(messages);
  } catch (err) { next(err); }
});

// POST /conversations/:id/send — vendedor envia mensagem pelo CRM
router.post('/:id/send', async (req: AuthRequest, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });

    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { contact: true },
    });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    const msg = await prisma.message.create({
      data: {
        conversationId: req.params.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        content: content.trim(),
      },
    });

    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { lastMessageAt: new Date() },
    });

    // Enviar via Z-API usando variáveis de ambiente (sem expor tokens)
    await sendTextMessage(conv.contact.phone, content.trim(), conv.storeId).catch((e: any) =>
      console.error('Z-API send error:', e.message)
    );

    emitNewMessage(req.params.id, {
      id: msg.id,
      conversationId: req.params.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
    });

    res.json(msg);
  } catch (err) { next(err); }
});

// POST /conversations/:id/assume — vendedor assume atendimento humano
router.post('/:id/assume', async (req: AuthRequest, res, next) => {
  try {
    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: {
        assignedUserId: req.user!.id,
        mode: 'HUMANO',
        aiEnabled: false,
        status: 'EM_ATENDIMENTO',
      },
    });
    emitConversationUpdate(req.params.id, { mode: 'HUMANO', assignedUserId: req.user!.id, status: 'EM_ATENDIMENTO' });
    res.json(conv);
  } catch (err) { next(err); }
});

// POST /conversations/:id/wait — marcar como aguardando cliente
router.post('/:id/wait', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { status: 'AGUARDANDO_CLIENTE' },
    });
    emitConversationUpdate(req.params.id, { status: 'AGUARDANDO_CLIENTE' });
    res.json(conv);
  } catch (err) { next(err); }
});

// POST /conversations/:id/close — fechar conversa
router.post('/:id/close', async (req, res, next) => {
  try {
    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { status: 'FECHADO', aiEnabled: false },
    });
    emitConversationUpdate(req.params.id, { status: 'FECHADO' });
    res.json(conv);
  } catch (err) { next(err); }
});

// POST /conversations/:id/read — zerar não-lidos ao abrir conversa
router.post('/:id/read', async (req, res, next) => {
  try {
    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { unreadCount: 0 },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /conversations/:id/pause-ai
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

// POST /conversations/:id/resume-ai
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

// POST /conversations/:id/transfer — transferir para outro usuário
router.post('/:id/transfer', async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

    const conv = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { assignedUserId: userId, mode: 'HUMANO', aiEnabled: false },
    });
    emitConversationUpdate(req.params.id, { assignedUserId: userId, mode: 'HUMANO' });
    res.json(conv);
  } catch (err) { next(err); }
});

// PUT /conversations/:id/status — alterar status manualmente
router.put('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const valid = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE', 'FECHADO'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido', valid });

    const conv = await prisma.conversation.update({ where: { id: req.params.id }, data: { status } });
    emitConversationUpdate(req.params.id, { status });
    res.json(conv);
  } catch (err) { next(err); }
});

export default router;
