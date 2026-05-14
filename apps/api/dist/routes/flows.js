"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const flowEngine_1 = require("../services/flowEngine");
const flowValidation_1 = require("../services/flowValidation");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticate);
function safeJson(val) {
    if (val == null)
        return null;
    if (typeof val !== 'string')
        return val;
    try {
        return JSON.parse(val);
    }
    catch {
        return val;
    }
}
function serializeJson(val) {
    if (val == null)
        return '{}';
    if (typeof val === 'string')
        return val;
    return JSON.stringify(val);
}
function parseFlowJson(flow) {
    if (!flow)
        return flow;
    return {
        ...flow,
        nodes: flow.nodes?.map((n) => ({
            ...n,
            config: safeJson(n.config) ?? {},
        })),
        edges: flow.edges?.map((e) => ({
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
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id', async (req, res, next) => {
    try {
        const flow = await prisma.flow.findUnique({ where: { id: req.params.id }, include: flowInclude });
        if (!flow)
            return res.status(404).json({ error: 'Fluxo não encontrado' });
        res.json(parseFlowJson(flow));
    }
    catch (err) {
        next(err);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const flow = await prisma.flow.create({
            data: {
                name: req.body.name || 'Novo Fluxo',
                description: req.body.description,
                createdById: req.user.id,
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
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', async (req, res, next) => {
    try {
        const { nodes, edges, triggers, ...flowData } = req.body;
        await prisma.$transaction(async (tx) => {
            if (nodes !== undefined) {
                // FlowExecutionStep referencia FlowNode sem cascade — precisamos limpar os
                // steps das execuções deste fluxo antes de deletar os nodes para evitar
                // "Foreign key constraint violated"
                const executions = await tx.flowExecution.findMany({
                    where: { flowId: req.params.id },
                    select: { id: true },
                });
                if (executions.length > 0) {
                    await tx.flowExecutionStep.deleteMany({
                        where: { executionId: { in: executions.map((e) => e.id) } },
                    });
                }
                await tx.flowNode.deleteMany({ where: { flowId: req.params.id } });
                if (nodes.length > 0) {
                    await tx.flowNode.createMany({
                        data: nodes.map((n) => ({
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
                        data: edges.map((e) => ({
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
                        data: triggers.map((t) => ({ ...t, flowId: req.params.id })),
                    });
                }
            }
            await tx.flow.update({ where: { id: req.params.id }, data: { ...flowData, version: { increment: 1 } } });
        });
        const updated = await prisma.flow.findUnique({ where: { id: req.params.id }, include: flowInclude });
        res.json(parseFlowJson(updated));
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/toggle', async (req, res, next) => {
    try {
        const flow = await prisma.flow.findUnique({
            where: { id: req.params.id },
            include: { nodes: true, edges: true },
        });
        if (!flow)
            return res.status(404).json({ error: 'Fluxo não encontrado' });
        // Ao ativar, valida o fluxo com o serviço de validação
        if (!flow.active) {
            const validation = (0, flowValidation_1.validateFlow)(flow.nodes.map(n => ({ id: n.id, type: n.type, title: n.title, config: safeJson(n.config) ?? {} })), flow.edges.map(e => ({ id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })));
            if (!validation.valid) {
                return res.status(400).json({
                    error: 'Fluxo inválido — corrija os erros antes de ativar',
                    errors: validation.errors,
                    warnings: validation.warnings,
                });
            }
        }
        const updated = await prisma.flow.update({
            where: { id: req.params.id },
            data: { active: !flow.active },
            include: flowInclude,
        });
        res.json(parseFlowJson(updated));
    }
    catch (err) {
        next(err);
    }
});
// POST /flows/:id/validate — valida sem ativar
router.post('/:id/validate', async (req, res, next) => {
    try {
        const flow = await prisma.flow.findUnique({
            where: { id: req.params.id },
            include: { nodes: true, edges: true },
        });
        if (!flow)
            return res.status(404).json({ error: 'Fluxo não encontrado' });
        const result = (0, flowValidation_1.validateFlow)(flow.nodes.map(n => ({ id: n.id, type: n.type, title: n.title, config: safeJson(n.config) ?? {} })), flow.edges.map(e => ({ id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })));
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/duplicate', async (req, res, next) => {
    try {
        const original = await prisma.flow.findUnique({
            where: { id: req.params.id },
            include: { nodes: true, edges: true, triggers: true },
        });
        if (!original)
            return res.status(404).json({ error: 'Fluxo não encontrado' });
        const nodeIdMap = {};
        const newFlow = await prisma.flow.create({
            data: {
                name: `${original.name} (cópia)`,
                description: original.description,
                active: false,
                createdById: req.user.id,
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
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', async (req, res, next) => {
    try {
        const flowId = req.params.id;
        // Verifica se o fluxo existe antes de tentar deletar
        const flow = await prisma.flow.findUnique({ where: { id: flowId } });
        if (!flow)
            return res.status(404).json({ error: 'Fluxo não encontrado' });
        // Deleta em transação na ordem correta para satisfazer as FK constraints:
        // 1. FlowExecutionStep  (depende de FlowExecution e FlowNode)
        // 2. FlowExecution      (depende de Flow)
        // 3. FlowTrigger        (cascade existe mas deletamos explicitamente por segurança)
        // 4. FlowEdge           (cascade existe)
        // 5. FlowNode           (cascade existe)
        // 6. Flow               (raiz)
        await prisma.$transaction(async (tx) => {
            // Busca IDs de execuções deste fluxo para deletar seus steps
            const executions = await tx.flowExecution.findMany({
                where: { flowId },
                select: { id: true },
            });
            const executionIds = executions.map((e) => e.id);
            if (executionIds.length > 0) {
                await tx.flowExecutionStep.deleteMany({
                    where: { executionId: { in: executionIds } },
                });
                await tx.flowExecution.deleteMany({ where: { flowId } });
            }
            // FlowTrigger, FlowEdge, FlowNode têm onDelete: Cascade, mas
            // deletamos explicitamente para garantir (SQLite às vezes ignora cascades
            // quando pragma foreign_keys está off)
            await tx.flowTrigger.deleteMany({ where: { flowId } });
            await tx.flowEdge.deleteMany({ where: { flowId } });
            await tx.flowNode.deleteMany({ where: { flowId } });
            await tx.flow.delete({ where: { id: flowId } });
        });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// POST /:id/trigger — disparo manual pelo Inbox
router.post('/:id/trigger', async (req, res, next) => {
    try {
        const { conversationId, leadId } = req.body;
        if (!conversationId)
            return res.status(400).json({ error: 'conversationId obrigatório' });
        const executionId = await (0, flowEngine_1.executeFlow)(req.params.id, conversationId, leadId);
        res.json({ success: true, executionId });
    }
    catch (err) {
        next(err);
    }
});
// GET /:id/executions — histórico de execuções
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
    }
    catch (err) {
        next(err);
    }
});
// ─── Endpoints de sandbox/teste ───────────────────────────────────────────────
// POST /:id/test/start — inicia execução em modo teste (sem Z-API, sem API externa)
router.post('/:id/test/start', async (req, res, next) => {
    try {
        const { conversationId: reqConvId, leadId } = req.body;
        let conversationId = reqConvId;
        if (!conversationId) {
            // Cria SEMPRE uma conversa nova e isolada para cada sessão de teste.
            // Isso evita mistura de mensagens de execuções anteriores.
            const testPhone = `test-${req.user.id}`;
            let contact = await prisma.contact.findUnique({ where: { phone: testPhone } });
            if (!contact) {
                contact = await prisma.contact.create({
                    data: { name: 'Simulador de Teste', phone: testPhone },
                });
            }
            // Cancela qualquer execução WAITING_RESPONSE anterior neste contato
            const oldConvs = await prisma.conversation.findMany({
                where: { contactId: contact.id },
                select: { id: true },
            });
            if (oldConvs.length > 0) {
                await prisma.flowExecution.updateMany({
                    where: {
                        conversationId: { in: oldConvs.map(c => c.id) },
                        status: 'WAITING_RESPONSE',
                    },
                    data: { status: 'FAILED', error: 'Cancelado — nova sessão de teste iniciada', finishedAt: new Date() },
                });
            }
            // Sempre cria conversa nova para sandbox limpo
            const newConv = await prisma.conversation.create({
                data: { contactId: contact.id, status: 'NOVO', aiEnabled: false },
            });
            conversationId = newConv.id;
        }
        // forceRun=true permite testar fluxos ainda não ativados
        const executionId = await (0, flowEngine_1.executeFlow)(req.params.id, conversationId, leadId, /* testMode */ true, /* forceRun */ true);
        if (!executionId) {
            return res.status(400).json({ error: 'Fluxo não pôde ser iniciado. Verifique se tem nó START.' });
        }
        const execution = await prisma.flowExecution.findUnique({
            where: { id: executionId },
            include: {
                steps: {
                    orderBy: { createdAt: 'asc' },
                    include: { node: { select: { id: true, type: true, title: true } } },
                },
            },
        });
        res.json({ executionId, conversationId, execution });
    }
    catch (err) {
        next(err);
    }
});
// POST /test/:executionId/message — envia mensagem do cliente para execução aguardando
router.post('/test/:executionId/message', async (req, res, next) => {
    try {
        const { message } = req.body;
        if (!message?.trim())
            return res.status(400).json({ error: 'message obrigatório' });
        await (0, flowEngine_1.continueExecutionWithResponse)(req.params.executionId, message.trim());
        const execution = await prisma.flowExecution.findUnique({
            where: { id: req.params.executionId },
            include: {
                steps: {
                    orderBy: { createdAt: 'asc' },
                    include: { node: { select: { id: true, type: true, title: true } } },
                },
            },
        });
        if (!execution)
            return res.status(404).json({ error: 'Execução não encontrada' });
        // Busca apenas mensagens desta execução (filtro por startedAt da execução)
        const messages = execution?.conversationId && execution.startedAt
            ? await prisma.message.findMany({
                where: {
                    conversationId: execution.conversationId,
                    fromFlow: true,
                    createdAt: { gte: execution.startedAt },
                },
                orderBy: { createdAt: 'asc' },
            })
            : [];
        res.json({
            execution: {
                ...execution,
                steps: execution.steps.map(s => ({
                    ...s,
                    input: safeJson(s.input),
                    output: safeJson(s.output),
                })),
            },
            messages,
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /test/:executionId/logs — logs e steps de uma execução
router.get('/test/:executionId/logs', async (req, res, next) => {
    try {
        const execution = await prisma.flowExecution.findUnique({
            where: { id: req.params.executionId },
            include: {
                steps: {
                    orderBy: { createdAt: 'asc' },
                    include: { node: { select: { id: true, type: true, title: true } } },
                },
                flow: { select: { id: true, name: true } },
            },
        });
        if (!execution)
            return res.status(404).json({ error: 'Execução não encontrada' });
        // Filtra mensagens apenas desta execução pelo timestamp de início
        const messages = execution.conversationId && execution.startedAt
            ? await prisma.message.findMany({
                where: {
                    conversationId: execution.conversationId,
                    fromFlow: true,
                    createdAt: { gte: execution.startedAt },
                },
                orderBy: { createdAt: 'asc' },
            })
            : [];
        res.json({
            ...execution,
            steps: execution.steps.map(s => ({
                ...s,
                input: safeJson(s.input),
                output: safeJson(s.output),
            })),
            messages,
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=flows.js.map