import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { executeFlow } from '../services/flowEngine';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

function safeJson(val: any) {
  if (val == null) return null;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

function serializeJson(val: any): string {
  if (val == null) return '{}';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function parseFlowJson(flow: any) {
  if (!flow) return flow;
  return {
    ...flow,
    nodes: flow.nodes?.map((n: any) => ({
      ...n,
      config: safeJson(n.config) ?? {},
    })),
    edges: flow.edges?.map((e: any) => ({
      ...e,
      condition: e.condition ? safeJson(e.condition) : null,
    })),
  };
}

const flowInclude = {
  nodes: true,
  edges: true,
  triggers: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { executions: true } },
};

router.get('/', async (req, res, next) => {
  try {
    const flows = await prisma.flow.findMany({ include: flowInclude, orderBy: { updatedAt: 'desc' } });
    res.json(flows.map(parseFlowJson));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const flow = await prisma.flow.findUnique({ where: { id: req.params.id }, include: flowInclude });
    if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado' });
    res.json(parseFlowJson(flow));
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const flow = await prisma.flow.create({
      data: {
        name: req.body.name || 'Novo Fluxo',
        description: req.body.description,
        createdById: req.user!.id,
        nodes: {
          create: [
            { type: 'START', title: 'Início', positionX: 100, positionY: 100, config: '{}' },
            { type: 'END', title: 'Fim', positionX: 500, positionY: 100, config: '{}' },
          ],
        },
      },
      include: flowInclude,
    });
    res.status(201).json(parseFlowJson(flow));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { nodes, edges, triggers, ...flowData } = req.body;

    await prisma.$transaction(async (tx) => {
      if (nodes !== undefined) {
        await tx.flowNode.deleteMany({ where: { flowId: req.params.id } });
        if (nodes.length > 0) {
          await tx.flowNode.createMany({
            data: nodes.map((n: any) => ({
              id: n.id,
              flowId: req.params.id,
              type: n.type,
              title: n.title || n.data?.label,
              config: serializeJson(n.data?.config ?? n.config ?? {}),
              positionX: n.position?.x ?? n.positionX ?? 0,
              positionY: n.position?.y ?? n.positionY ?? 0,
            })),
          });
        }
      }

      if (edges !== undefined) {
        await tx.flowEdge.deleteMany({ where: { flowId: req.params.id } });
        if (edges.length > 0) {
          await tx.flowEdge.createMany({
            data: edges.map((e: any) => ({
              id: e.id,
              flowId: req.params.id,
              sourceNodeId: e.source || e.sourceNodeId,
              targetNodeId: e.target || e.targetNodeId,
              condition: e.condition != null ? serializeJson(e.condition) : null,
              label: e.label || null,
            })),
          });
        }
      }

      if (triggers !== undefined) {
        await tx.flowTrigger.deleteMany({ where: { flowId: req.params.id } });
        if (triggers.length > 0) {
          await tx.flowTrigger.createMany({
            data: triggers.map((t: any) => ({ ...t, flowId: req.params.id })),
          });
        }
      }

      await tx.flow.update({ where: { id: req.params.id }, data: { ...flowData, version: { increment: 1 } } });
    });

    const updated = await prisma.flow.findUnique({ where: { id: req.params.id }, include: flowInclude });
    res.json(parseFlowJson(updated));
  } catch (err) { next(err); }
});

router.post('/:id/toggle', async (req, res, next) => {
  try {
    const flow = await prisma.flow.findUnique({ where: { id: req.params.id }, include: { nodes: true } });
    if (!flow) return res.status(404).json({ error: 'Fluxo não encontrado' });

    if (!flow.active) {
      const hasStart = flow.nodes.some(n => n.type === 'START');
      const hasEnd = flow.nodes.some(n => n.type === 'END');
      if (!hasStart || !hasEnd) {
        return res.status(400).json({ error: 'Fluxo precisa de nó START e END para ser ativado' });
      }
    }

    const updated = await prisma.flow.update({
      where: { id: req.params.id },
      data: { active: !flow.active },
      include: flowInclude,
    });
    res.json(parseFlowJson(updated));
  } catch (err) { next(err); }
});

router.post('/:id/duplicate', async (req: AuthRequest, res, next) => {
  try {
    const original = await prisma.flow.findUnique({
      where: { id: req.params.id },
      include: { nodes: true, edges: true, triggers: true },
    });
    if (!original) return res.status(404).json({ error: 'Fluxo não encontrado' });

    const nodeIdMap: Record<string, string> = {};
    const newFlow = await prisma.flow.create({
      data: {
        name: `${original.name} (cópia)`,
        description: original.description,
        active: false,
        createdById: req.user!.id,
        nodes: {
          create: original.nodes.map(n => {
            const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            nodeIdMap[n.id] = newId;
            return {
              id: newId,
              type: n.type,
              title: n.title,
              config: n.config,
              positionX: n.positionX,
              positionY: n.positionY,
            };
          }),
        },
        edges: {
          create: original.edges.map(e => ({
            sourceNodeId: nodeIdMap[e.sourceNodeId] || e.sourceNodeId,
            targetNodeId: nodeIdMap[e.targetNodeId] || e.targetNodeId,
            condition: e.condition,
            label: e.label,
          })),
        },
        triggers: { create: original.triggers.map(t => ({ type: t.type, value: t.value, active: false })) },
      },
      include: flowInclude,
    });
    res.status(201).json(parseFlowJson(newFlow));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.flow.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/:id/trigger', async (req, res, next) => {
  try {
    const { conversationId, leadId } = req.body;
    if (!conversationId) return res.status(400).json({ error: 'conversationId obrigatório' });
    await executeFlow(req.params.id, conversationId, leadId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/:id/executions', async (req, res, next) => {
  try {
    const executions = await prisma.flowExecution.findMany({
      where: { flowId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { steps: true, conversation: true, lead: true },
    });
    res.json(executions.map(ex => ({
      ...ex,
      steps: ex.steps.map(s => ({
        ...s,
        input: safeJson(s.input),
        output: safeJson(s.output),
      })),
    })));
  } catch (err) { next(err); }
});

export default router;
