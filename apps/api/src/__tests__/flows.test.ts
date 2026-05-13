import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateFlow } from '../services/flowValidation';
import { executeFlow, continueExecutionWithResponse } from '../services/flowEngine';
import { sendTextMessage } from '../services/zapiService';

// ─── Estado in-memory compartilhado entre mocks e testes ────────────────────
const __db = vi.hoisted(() => ({
  exec:  {} as Record<string, any>,
  step:  {} as Record<string, any>,
  flow:  null as any,
  idSeq: 0,
}));

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    flow: {
      findUnique: vi.fn(({ where }: any) =>
        Promise.resolve(__db.flow?.id === where.id ? __db.flow : null),
      ),
    },
    flowExecution: {
      create: vi.fn(({ data }: any) => {
        const id = `exec-${++__db.idSeq}`;
        __db.exec[id] = { id, ...data };
        return Promise.resolve(__db.exec[id]);
      }),
      update: vi.fn(({ where, data }: any) => {
        __db.exec[where.id] = { ...__db.exec[where.id], ...data };
        return Promise.resolve(__db.exec[where.id]);
      }),
      findUnique: vi.fn(({ where }: any) => {
        const exec = __db.exec[where.id];
        if (!exec) return Promise.resolve(null);
        return Promise.resolve({ ...exec, flow: __db.flow });
      }),
    },
    flowExecutionStep: {
      create: vi.fn(({ data }: any) => {
        const id = `step-${++__db.idSeq}`;
        __db.step[id] = { id, ...data };
        return Promise.resolve(__db.step[id]);
      }),
      update: vi.fn(({ where, data }: any) => {
        if (__db.step[where.id]) {
          __db.step[where.id] = { ...__db.step[where.id], ...data };
        }
        return Promise.resolve(__db.step[where.id] ?? {});
      }),
      count: vi.fn(({ where }: any) => {
        const count = Object.values(__db.step).filter((s: any) => {
          if (where.executionId && s.executionId !== where.executionId) return false;
          if (where.nodeId && s.nodeId !== where.nodeId) return false;
          if (where.NOT?.input === '{}' && s.input === '{}') return false;
          return true;
        }).length;
        return Promise.resolve(count);
      }),
    },
    message: {
      create: vi.fn(({ data }: any) =>
        Promise.resolve({ id: `msg-${++__db.idSeq}`, createdAt: new Date(), ...data }),
      ),
      findMany: vi.fn(() => Promise.resolve([])),
      count:    vi.fn(() => Promise.resolve(0)),
    },
    conversation: {
      findUnique: vi.fn(() =>
        Promise.resolve({ id: 'conv-1', storeId: 'store-1', contact: { phone: '11999999999' } }),
      ),
      update: vi.fn(({ where, data }: any) =>
        Promise.resolve({ id: where.id, ...data }),
      ),
    },
    automationLog: {
      create: vi.fn(() => Promise.resolve({ id: 'log-1' })),
    },
    lead: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      update:     vi.fn(() => Promise.resolve({})),
    },
    flowTrigger: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
    tag: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      create:    vi.fn(({ data }: any) => Promise.resolve({ id: `tag-${++__db.idSeq}`, ...data })),
    },
    leadTag: {
      upsert: vi.fn(() => Promise.resolve({})),
    },
    customField: {
      findUnique: vi.fn(() => Promise.resolve(null)),
    },
  })),
}));

vi.mock('../services/zapiService', () => ({
  sendTextMessage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../socket', () => ({
  emitNewMessage:          vi.fn(),
  emitConversationUpdate:  vi.fn(),
  emitNewConversation:     vi.fn(),
  emitToUser:              vi.fn(),
}));

vi.mock('../services/aiService', () => ({
  generateAiResponse:   vi.fn().mockResolvedValue('mock AI reply'),
  determineAgentStage:  vi.fn().mockReturnValue('SDR'),
}));

// ─── Helpers de fixture ───────────────────────────────────────────────────────
const node = (id: string, type: string, config: Record<string, any> = {}) =>
  ({ id, type, config, title: type });

const edge = (id: string, src: string, tgt: string, label?: string) =>
  ({ id, sourceNodeId: src, targetNodeId: tgt, condition: null, label: label ?? null });

const makeFlow = (nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) => ({
  id: 'flow-1',
  active: true,
  name: 'Test Flow',
  nodes,
  edges,
});

// ─── Testes de Validação ──────────────────────────────────────────────────────
describe('Flow Validation', () => {
  it('valida fluxo válido START → MESSAGE → END', () => {
    const nodes = [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Olá!' }), node('n3', 'END')];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('valida fluxo válido START → QUESTION → END', () => {
    const nodes = [node('n1', 'START'), node('n2', 'QUESTION', { text: 'Qual seu nome?' }), node('n3', 'END')];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('valida fluxo válido START → MENU → END', () => {
    const nodes = [
      node('n1', 'START'),
      node('n2', 'MENU', { text: 'Escolha', options: [{ label: 'Op 1', value: '1' }] }),
      node('n3', 'END'),
    ];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(true);
  });

  it('bloqueia fluxo sem nó START', () => {
    const nodes = [node('n1', 'MESSAGE', { text: 'Olá!' }), node('n2', 'END')];
    const edges = [edge('e1', 'n1', 'n2')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.message.includes('INÍCIO'))).toBe(true);
  });

  it('bloqueia fluxo sem nó END', () => {
    const nodes = [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Olá!' })];
    const edges = [edge('e1', 'n1', 'n2')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.message.includes('FIM'))).toBe(true);
  });

  it('bloqueia MESSAGE sem texto', () => {
    const nodes = [node('n1', 'START'), node('n2', 'MESSAGE', {}), node('n3', 'END')];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.nodeId === 'n2')).toBe(true);
  });

  it('bloqueia QUESTION sem texto', () => {
    const nodes = [node('n1', 'START'), node('n2', 'QUESTION', {}), node('n3', 'END')];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.nodeId === 'n2')).toBe(true);
  });

  it('bloqueia MENU sem texto', () => {
    const nodes = [
      node('n1', 'START'),
      node('n2', 'MENU', { options: [{ label: 'Sim', value: '1' }] }),
      node('n3', 'END'),
    ];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.nodeId === 'n2' && err.message.includes('texto'))).toBe(true);
  });

  it('bloqueia MENU sem opções', () => {
    const nodes = [
      node('n1', 'START'),
      node('n2', 'MENU', { text: 'Escolha:', options: [] }),
      node('n3', 'END'),
    ];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.nodeId === 'n2' && err.message.includes('opção'))).toBe(true);
  });

  it('bloqueia MENU com opção sem rótulo', () => {
    const nodes = [
      node('n1', 'START'),
      node('n2', 'MENU', { text: 'Escolha:', options: [{ label: '', value: '1' }] }),
      node('n3', 'END'),
    ];
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')];
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.nodeId === 'n2')).toBe(true);
  });

  it('bloqueia START desconectado', () => {
    const nodes = [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Olá!' }), node('n3', 'END')];
    const edges = [edge('e1', 'n2', 'n3')]; // START não conectado
    const result = validateFlow(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.nodeId === 'n1')).toBe(true);
  });
});

// ─── Testes do Motor de Fluxos ────────────────────────────────────────────────
describe('Flow Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __db.exec  = {};
    __db.step  = {};
    __db.flow  = null;
    __db.idSeq = 0;
  });

  // ── MESSAGE ─────────────────────────────────────────────────────────────────

  it('executa fluxo START→MESSAGE→END em testMode sem chamar Z-API', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Bem-vindo!' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(execId).toBeTruthy();
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  it('cria FlowExecutionStep para cada nó executado', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Olá!' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    await executeFlow('flow-1', 'conv-1', undefined, true);
    // START, MESSAGE, END = 3 steps
    expect(Object.keys(__db.step).length).toBeGreaterThanOrEqual(3);
  });

  it('finaliza em END com status COMPLETED e finishedAt', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Tchau!' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(execId).toBeTruthy();
    expect(__db.exec[execId!].status).toBe('COMPLETED');
    expect(__db.exec[execId!].finishedAt).toBeDefined();
  });

  it('retorna null se fluxo não existir', async () => {
    __db.flow = null;
    const execId = await executeFlow('flow-inexistente', 'conv-1', undefined, true);
    expect(execId).toBeNull();
  });

  it('retorna null se fluxo inativo sem forceRun', async () => {
    __db.flow = { ...makeFlow(
      [node('n1', 'START'), node('n2', 'END')],
      [edge('e1', 'n1', 'n2')],
    ), active: false };
    const execId = await executeFlow('flow-1', 'conv-1', undefined, false, false);
    expect(execId).toBeNull();
  });

  it('executa fluxo inativo com forceRun=true (sandbox)', async () => {
    __db.flow = { ...makeFlow(
      [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Teste!' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    ), active: false };
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true, true);
    expect(execId).toBeTruthy();
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  // ── QUESTION ────────────────────────────────────────────────────────────────

  it('QUESTION suspende execução com status WAITING_RESPONSE', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'QUESTION', { text: 'Qual seu nome?' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(execId).toBeTruthy();
    expect(__db.exec[execId!].status).toBe('WAITING_RESPONSE');
    expect(__db.exec[execId!].currentNodeId).toBe('n2');
  });

  it('continueExecutionWithResponse retoma após QUESTION e completa', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'QUESTION', { text: 'Nome?' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(__db.exec[execId!].status).toBe('WAITING_RESPONSE');
    await continueExecutionWithResponse(execId!, 'Mario');
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  it('continueExecutionWithResponse não age em execução não WAITING_RESPONSE', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'END')],
      [edge('e1', 'n1', 'n2')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(__db.exec[execId!].status).toBe('COMPLETED');
    // Não deve alterar o status
    await continueExecutionWithResponse(execId!, 'algo');
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  // ── MENU ────────────────────────────────────────────────────────────────────

  it('MENU suspende execução com status WAITING_RESPONSE', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'MENU', {
          text: 'Como posso ajudar?',
          options: [
            { label: 'Comprar', value: '1' },
            { label: 'Suporte', value: '2' },
          ],
        }),
        node('n3', 'END'),
      ],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(execId).toBeTruthy();
    expect(__db.exec[execId!].status).toBe('WAITING_RESPONSE');
    expect(__db.exec[execId!].currentNodeId).toBe('n2');
  });

  it('MENU resposta "1" segue opção correta e completa', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'MENU', {
          text: 'Escolha:',
          options: [
            { label: 'Comprar', value: '1' },
            { label: 'Suporte', value: '2' },
          ],
        }),
        node('n3', 'END'),
      ],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3', '1')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(__db.exec[execId!].status).toBe('WAITING_RESPONSE');
    await continueExecutionWithResponse(execId!, '1');
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  it('MENU resposta pelo label da opção funciona', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'MENU', {
          text: 'Escolha:',
          options: [{ label: 'Comprar', value: '1' }],
        }),
        node('n3', 'END'),
      ],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    await continueExecutionWithResponse(execId!, 'Comprar');
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  it('MENU resposta inválida reenvia invalidMessage e mantém WAITING_RESPONSE', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'MENU', {
          text: 'Escolha:',
          options: [{ label: 'Comprar', value: '1' }],
          invalidMessage: 'Opção inválida!',
          maxAttempts: 3,
        }),
        node('n3', 'END'),
      ],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(__db.exec[execId!].status).toBe('WAITING_RESPONSE');
    await continueExecutionWithResponse(execId!, 'opção_inexistente');
    expect(__db.exec[execId!].status).toBe('WAITING_RESPONSE');
    expect(__db.exec[execId!].currentNodeId).toBe('n2');
  });

  it('MENU esgota maxAttempts e vai ao fallback (próximo nó)', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'MENU', {
          text: 'Escolha:',
          options: [{ label: 'Comprar', value: '1' }],
          maxAttempts: 1,
        }),
        node('n3', 'END'),
      ],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    // 1 tentativa inválida já esgota (maxAttempts=1)
    await continueExecutionWithResponse(execId!, 'invalido');
    // Ao esgotar, vai para END → COMPLETED
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  // ── CONDITION ───────────────────────────────────────────────────────────────

  it('CONDITION com field/operator/value está implementado no engine', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'CONDITION', { field: 'temperature', operator: 'equals', value: 'FRIO' }),
        node('n3', 'END'),
      ],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    // Lead null = fields vazios → CONDITION não bate → defaultNextNodeId/first edge → END
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(execId).toBeTruthy();
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  // ── SANDBOX / testMode ──────────────────────────────────────────────────────

  it('testMode=true nunca chama Z-API em MESSAGE', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'Oi!' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('testMode=true nunca chama Z-API em QUESTION', async () => {
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'QUESTION', { text: 'Nome?' }), node('n3', 'END')],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it('testMode=true nunca chama Z-API em MENU', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'MENU', { text: 'Menu', options: [{ label: 'Op1', value: '1' }] }),
        node('n3', 'END'),
      ],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
    );
    await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  // ── FLUXO COMPLETO START→MENU→MESSAGE→END ──────────────────────────────────

  it('executa fluxo START → MENU → MESSAGE → END com resposta válida', async () => {
    __db.flow = makeFlow(
      [
        node('n1', 'START'),
        node('n2', 'MENU', {
          text: 'O que você precisa?',
          options: [
            { label: 'Comprar', value: '1' },
            { label: 'Suporte', value: '2' },
          ],
        }),
        node('n3', 'MESSAGE', { text: 'Ótima escolha! Vou te ajudar com a compra.' }),
        node('n4', 'END'),
      ],
      [
        edge('e1', 'n1', 'n2'),
        edge('e2', 'n2', 'n3', '1'), // opção 1 → mensagem de compra
        edge('e3', 'n3', 'n4'),
      ],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(__db.exec[execId!].status).toBe('WAITING_RESPONSE');
    await continueExecutionWithResponse(execId!, '1');
    expect(__db.exec[execId!].status).toBe('COMPLETED');
  });

  // ── DETECÇÃO DE LOOP ────────────────────────────────────────────────────────

  it('falha controlado em caso de loop (mais de 50 nós)', async () => {
    // Cria fluxo com 2 nós em loop infinito
    __db.flow = makeFlow(
      [node('n1', 'START'), node('n2', 'MESSAGE', { text: 'loop' })],
      [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n1')],
    );
    const execId = await executeFlow('flow-1', 'conv-1', undefined, true);
    expect(execId).toBeTruthy();
    expect(__db.exec[execId!].status).toBe('FAILED');
    expect(__db.exec[execId!].error).toContain('loop');
  });
});
