import { PrismaClient } from '@prisma/client';
import { generateAiResponse, determineAgentStage, AgentType, LeadContext } from './aiService';
import { sendTextMessage } from './zapiService';
import { emitNewMessage } from '../socket';

const prisma = new PrismaClient();

// ─── Eventos conversacionais: se um fluxo desses rodar, IA não faz fallback ──
export const CONVERSATIONAL_EVENTS = new Set([
  'MESSAGE_RECEIVED',
  'KEYWORD',
  'FIRST_MESSAGE',
]);

// ─── Trigger + execute (retorna true se ao menos um fluxo executou) ───────────
export async function triggerFlowsByEvent(
  eventType: string,
  value: string,
  conversationId: string,
  leadId: string,
): Promise<boolean> {
  const triggers = await prisma.flowTrigger.findMany({
    where:   { type: eventType as any, active: true },
    include: { flow: { include: { nodes: true, edges: true } } },
  });

  if (triggers.length === 0) return false;

  let anyExecuted = false;

  for (const trigger of triggers) {
    if (!trigger.flow.active) continue;

    if (eventType === 'KEYWORD' && trigger.value) {
      if (!value.toLowerCase().includes(trigger.value.toLowerCase())) continue;
    }

    try {
      await executeFlow(trigger.flow.id, conversationId, leadId);
      anyExecuted = true;
      await prisma.automationLog.create({
        data: {
          type:           'FLOW_EXECUTED',
          description:    `Fluxo "${trigger.flow.name}" executado | evento: ${eventType}`,
          data:           JSON.stringify({ eventType, value: value.substring(0, 100), flowId: trigger.flow.id }),
          conversationId,
          leadId,
        },
      }).catch(() => {});
      console.log(`[FLOW_EXECUTED] | fluxo: "${trigger.flow.name}" | evento: ${eventType} | conv: ${conversationId}`);
    } catch (flowErr: any) {
      console.error(`[FLOW_EVENT_FAILED] | evento: ${eventType} | fluxo: ${trigger.flow.id} |`, flowErr.message);
      await prisma.automationLog.create({
        data: {
          type:        'FLOW_EVENT_FAILED',
          description: `Falha ao executar fluxo "${trigger.flow.name}": ${flowErr.message}`,
          data:        JSON.stringify({ eventType, flowId: trigger.flow.id, error: flowErr.message }),
          conversationId,
          leadId,
        },
      }).catch(() => {});
    }
  }

  return anyExecuted;
}

// ─── Inicia execução de um fluxo ─────────────────────────────────────────────
export async function executeFlow(
  flowId: string,
  conversationId: string,
  leadId?: string,
  testMode = false,
  forceRun = false, // permite executar fluxo inativo (sandbox/teste)
): Promise<string | null> {
  const flow = await prisma.flow.findUnique({
    where:   { id: flowId },
    include: { nodes: true, edges: true },
  });

  if (!flow || (!flow.active && !forceRun)) return null;

  const startNode = flow.nodes.find(n => n.type === 'START');
  if (!startNode) return null;

  const execution = await prisma.flowExecution.create({
    data: {
      flowId,
      conversationId,
      leadId,
      status:        'RUNNING',
      currentNodeId: startNode.id,
      testMode,
    },
  });

  try {
    await executeNode(execution.id, startNode.id, flow, conversationId, leadId, 0, testMode);

    // Só atualiza para COMPLETED se ainda não estiver WAITING_RESPONSE
    const updated = await prisma.flowExecution.findUnique({ where: { id: execution.id } });
    if (updated?.status === 'RUNNING') {
      await prisma.flowExecution.update({
        where: { id: execution.id },
        data:  { status: 'COMPLETED', finishedAt: new Date() },
      });
    }
  } catch (err: any) {
    await prisma.flowExecution.update({
      where: { id: execution.id },
      data:  { status: 'FAILED', error: err.message, finishedAt: new Date() },
    }).catch(() => {});
  }

  return execution.id;
}

// ─── Continua uma execução que estava aguardando resposta do cliente ──────────
export async function continueExecutionWithResponse(
  executionId: string,
  userMessage: string,
): Promise<void> {
  const execution = await prisma.flowExecution.findUnique({
    where:   { id: executionId },
    include: { flow: { include: { nodes: true, edges: true } } },
  });

  if (!execution || execution.status !== 'WAITING_RESPONSE') return;
  if (!execution.conversationId || !execution.currentNodeId) return;

  const currentNode = execution.flow.nodes.find((n: any) => n.id === execution.currentNodeId);

  await prisma.flowExecution.update({
    where: { id: executionId },
    data:  { status: 'RUNNING' },
  });

  // MENU: re-executa o próprio nó com o input do usuário para processar a escolha
  // QUESTION/outros: avança para o próximo nó passando a resposta
  const targetNodeId = currentNode?.type === 'MENU'
    ? execution.currentNodeId
    : getNextNode(execution.flow.edges, execution.currentNodeId);

  if (!targetNodeId) {
    await prisma.flowExecution.update({
      where: { id: executionId },
      data:  { status: 'COMPLETED', finishedAt: new Date() },
    });
    return;
  }

  try {
    await executeNode(
      executionId,
      targetNodeId,
      execution.flow,
      execution.conversationId,
      execution.leadId ?? undefined,
      0,
      execution.testMode ?? false,
      userMessage,
    );

    const updated = await prisma.flowExecution.findUnique({ where: { id: executionId } });
    if (updated?.status === 'RUNNING') {
      await prisma.flowExecution.update({
        where: { id: executionId },
        data:  { status: 'COMPLETED', finishedAt: new Date() },
      });
    }
  } catch (err: any) {
    await prisma.flowExecution.update({
      where: { id: executionId },
      data:  { status: 'FAILED', error: err.message, finishedAt: new Date() },
    }).catch(() => {});
  }
}

// ─── Helper: envia mensagem outbound no fluxo ─────────────────────────────────
async function sendFlowMessage(
  conversationId: string,
  nodeId: string,
  text: string,
  senderType: 'FLOW' | 'AI',
  testMode: boolean,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where:   { id: conversationId },
    include: { contact: true },
  });
  if (!conversation || !text.trim()) return;

  const msg = await prisma.message.create({
    data: {
      conversationId,
      direction:  'OUTBOUND',
      type:       'TEXT',
      content:    text.trim(),
      senderType,
      fromFlow:   true,
      flowNodeId: nodeId,
    },
  });

  if (!testMode) {
    // Normaliza telefone: remove não-dígitos, adiciona 55 apenas se ainda não começar com ele
    const digits     = conversation.contact.phone.replace(/\D/g, '');
    const zapiPhone  = digits.startsWith('55') ? digits : `55${digits}`;
    const masked     = zapiPhone.length > 7
      ? `${zapiPhone.slice(0, 4)}****${zapiPhone.slice(-3)}`
      : zapiPhone;

    console.log(`[FLOW_SEND_ATTEMPT] | source: flow | conv: ${conversationId} | phone: ${masked} | node: ${nodeId}`);

    try {
      const result = await sendTextMessage(zapiPhone, text.trim(), conversation.storeId);
      console.log(`[FLOW_SEND_OK] | source: flow | conv: ${conversationId} | phone: ${masked}`);
      void result;
    } catch (error: any) {
      console.error('[FLOW_SEND_ERROR]', {
        source:         'flow',
        conversationId,
        phone:          masked,
        status:         error?.response?.status  ?? null,
        body:           error?.response?.data     ?? null,
        message:        error?.message            ?? 'unknown',
      });
      throw error;
    }
  } else {
    console.log(
      `[FLOW_SEND_SKIPPED_TESTMODE] | conv: ${conversationId} | node: ${nodeId} | msg salva no DB — Z-API não chamada`,
    );
  }

  emitNewMessage(conversationId, {
    id:             msg.id,
    conversationId,
    direction:      'OUTBOUND',
    type:           'TEXT',
    content:        text.trim(),
    senderType,
    createdAt:      msg.createdAt.toISOString(),
    fromFlow:       true,
  });
}

// ─── Helper: chama um agente IA dentro do fluxo ───────────────────────────────
async function runAgentNode(
  agentType: AgentType,
  conversationId: string,
  nodeId: string,
  leadId: string | undefined,
  testMode: boolean,
): Promise<string> {
  // Em testMode retorna resposta mockada para não gastar API
  if (testMode) {
    const mockReplies: Record<AgentType, string> = {
      SDR:        '[Modo Teste] Boa tarde! Te ajudo sim. Você busca uma scooter elétrica para dia a dia, trabalho ou lazer?',
      QUALIFIER:  '[Modo Teste] Qual cidade ou bairro você está? Assim posso indicar a unidade mais próxima.',
      CONSULTANT: '[Modo Teste] Ótima escolha para mobilidade urbana! Temos opções com autonomia de até 80km por carga.',
    };
    const reply = mockReplies[agentType];
    await sendFlowMessage(conversationId, nodeId, reply, 'AI', testMode);
    return reply;
  }

  const recentMessages = await prisma.message.findMany({
    where:   { conversationId },
    orderBy: { createdAt: 'asc' },
    take:    15,
  });

  const chatHistory = recentMessages.map((m: any) => ({
    role:    (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }));

  const conversation = await prisma.conversation.findUnique({
    where:   { id: conversationId },
    include: { contact: true },
  });

  const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;
  const leadContext: LeadContext = {
    region:      lead?.region      ?? undefined,
    interest:    lead?.interest    ?? undefined,
    temperature: lead?.temperature ?? undefined,
  };

  const aiReply = await generateAiResponse(conversationId, chatHistory, conversation?.storeId, leadContext, agentType);
  if (aiReply) {
    await sendFlowMessage(conversationId, nodeId, aiReply, 'AI', testMode);
  }
  return aiReply;
}

// ─── Executor de nó ───────────────────────────────────────────────────────────
async function executeNode(
  executionId: string,
  nodeId: string,
  flow: any,
  conversationId: string,
  leadId?: string,
  depth = 0,
  testMode = false,
  userInput?: string, // resposta do cliente para QUESTION anterior
): Promise<void> {
  if (depth > 50) throw new Error('Flow loop detected — mais de 50 nós percorridos');

  const node = flow.nodes.find((n: any) => n.id === nodeId);
  if (!node) return;

  await prisma.flowExecution.update({
    where: { id: executionId },
    data:  { currentNodeId: nodeId },
  });

  const step = await prisma.flowExecutionStep.create({
    data: {
      executionId,
      nodeId,
      status: 'running',
      input:  userInput ? JSON.stringify({ userInput }) : '{}',
    },
  });

  let nextNodeId: string | null = null;
  let output: any = {};

  try {
    const config: any = typeof node.config === 'string'
      ? JSON.parse(node.config || '{}')
      : (node.config as any) || {};

    switch (node.type) {

      // ── Controle ────────────────────────────────────────────────────────────
      case 'START': {
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'END': {
        nextNodeId = null;
        output = { finished: true };
        break;
      }

      // ── Mensagem fixa ────────────────────────────────────────────────────────
      case 'MESSAGE': {
        const text = config.text || config.message || '';
        if (text.trim()) {
          await sendFlowMessage(conversationId, nodeId, text, 'FLOW', testMode);
          output = { sent: text };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      // ── Pergunta (aguarda resposta do cliente) ────────────────────────────────
      case 'QUESTION': {
        const question = config.text || config.question || '';
        if (question.trim()) {
          await sendFlowMessage(conversationId, nodeId, question, 'FLOW', testMode);
        }

        // Suspende execução aguardando resposta
        await prisma.flowExecution.update({
          where: { id: executionId },
          data:  { status: 'WAITING_RESPONSE', currentNodeId: nodeId },
        });

        output = { waiting: true, question };
        nextNodeId = null; // Interrompe aqui
        break;
      }

      // ── Menu de opções (aguarda escolha do cliente) ───────────────────────────
      case 'MENU': {
        const menuText    = config.text || config.message || '';
        const options     = Array.isArray(config.options) ? config.options : [];
        const invalidMsg  = config.invalidMessage || 'Opção inválida. Por favor, escolha uma das opções listadas.';
        const maxAttempts = Number(config.maxAttempts ?? 3);

        if (!userInput) {
          // Primeira execução: envia menu e aguarda
          if (menuText.trim()) {
            let fullMenu = menuText.trim();
            // Auto-adiciona lista de opções se não estiver no texto
            if (options.length > 0) {
              const hasNumberedLine = /^\d+\s*[-.)]\s*/m.test(fullMenu);
              if (!hasNumberedLine) {
                fullMenu += '\n\n' + options
                  .map((opt: any, i: number) => `${opt.value ?? (i + 1)} - ${opt.label}`)
                  .join('\n');
              }
            }
            await sendFlowMessage(conversationId, nodeId, fullMenu, 'FLOW', testMode);
          }
          await prisma.flowExecution.update({
            where: { id: executionId },
            data:  { status: 'WAITING_RESPONSE', currentNodeId: nodeId },
          });
          output    = { waiting: true, optionCount: options.length };
          nextNodeId = null;
        } else {
          // Usuário respondeu: tenta encontrar opção correspondente
          const normalized = userInput.trim().toLowerCase();
          let matchedOption: any = null;

          for (let i = 0; i < options.length; i++) {
            const opt      = options[i];
            const optValue = String(opt.value ?? (i + 1)).toLowerCase();
            const optLabel = String(opt.label  ?? '').toLowerCase();
            const aliases  = Array.isArray(opt.aliases)
              ? opt.aliases.map((a: string) => a.toLowerCase())
              : [];

            if (
              normalized === optValue ||
              normalized === optLabel ||
              aliases.includes(normalized) ||
              aliases.some((a: string) => normalized.includes(a))
            ) {
              matchedOption = opt;
              break;
            }
          }

          if (matchedOption) {
            // Encontrou a opção — navega para o destino
            const matchedEdge = flow.edges.find((e: any) => {
              if (e.sourceNodeId !== nodeId) return false;
              const cond = typeof e.condition === 'string'
                ? e.condition
                : (e.condition?.value ?? e.condition?.label ?? '');
              return (
                cond === String(matchedOption.value ?? '') ||
                e.label === String(matchedOption.value ?? '') ||
                e.label === matchedOption.label
              );
            });
            nextNodeId = matchedOption.nextNodeId || matchedEdge?.targetNodeId || getNextNode(flow.edges, nodeId);
            output     = { matched: matchedOption.label, value: matchedOption.value, userInput };

            // Salva escolha no campo personalizado se configurado
            if (config.saveToField && leadId) {
              prisma.customField.findUnique({ where: { key: config.saveToField } }).then(field => {
                if (field && leadId) {
                  return prisma.customFieldValue.upsert({
                    where:  { customFieldId_leadId: { customFieldId: field.id, leadId } },
                    update: { value: userInput },
                    create: { customFieldId: field.id, leadId, value: userInput },
                  });
                }
              }).catch(() => {});
            }
          } else {
            // Opção não encontrada — verifica tentativas
            const attemptCount = await prisma.flowExecutionStep.count({
              where: { executionId, nodeId, NOT: { input: '{}' } },
            });

            if (attemptCount >= maxAttempts) {
              // Esgotou tentativas — vai ao fallback
              nextNodeId = config.fallbackNextNodeId || getNextNode(flow.edges, nodeId);
              output     = { maxAttemptsReached: true, attempts: attemptCount };
            } else {
              // Reenvia mensagem de erro e aguarda novamente
              await sendFlowMessage(conversationId, nodeId, invalidMsg, 'FLOW', testMode);
              await prisma.flowExecution.update({
                where: { id: executionId },
                data:  { status: 'WAITING_RESPONSE', currentNodeId: nodeId },
              });
              output    = { invalid: true, attempt: attemptCount + 1, userInput };
              nextNodeId = null;
            }
          }
        }
        break;
      }

      // ── Resposta IA genérica (auto-detect agente) ────────────────────────────
      case 'AI_RESPONSE': {
        if (testMode) {
          const mock = '[Modo Teste] Olá! Posso te ajudar com informações sobre nossas scooters elétricas.';
          await sendFlowMessage(conversationId, nodeId, mock, 'AI', testMode);
          output = { aiReply: mock, testMode: true };
        } else {
          const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;
          const inboundCount = await prisma.message.count({
            where: { conversationId, direction: 'INBOUND' },
          });
          const agentType = determineAgentStage(
            { region: lead?.region, interest: lead?.interest, temperature: lead?.temperature ?? 'FRIO' },
            inboundCount,
          );
          const aiReply = await runAgentNode(agentType, conversationId, nodeId, leadId, testMode);
          output = { agentType, aiReply };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      // ── Agentes comerciais ────────────────────────────────────────────────────
      case 'AGENT_SDR': {
        const aiReply = await runAgentNode('SDR', conversationId, nodeId, leadId, testMode);
        nextNodeId = getNextNode(flow.edges, nodeId);
        output = { agentType: 'SDR', aiReply };
        break;
      }

      case 'AGENT_QUALIFIER': {
        const aiReply = await runAgentNode('QUALIFIER', conversationId, nodeId, leadId, testMode);
        nextNodeId = getNextNode(flow.edges, nodeId);
        output = { agentType: 'QUALIFIER', aiReply };
        break;
      }

      case 'AGENT_CONSULTANT': {
        const aiReply = await runAgentNode('CONSULTANT', conversationId, nodeId, leadId, testMode);
        nextNodeId = getNextNode(flow.edges, nodeId);
        output = { agentType: 'CONSULTANT', aiReply };
        break;
      }

      case 'AGENT_HANDOFF': {
        const conv = await prisma.conversation.findUnique({
          where:   { id: conversationId },
          include: { lead: true },
        });
        if (conv?.lead) {
          const { initiateHandoff } = await import('./handoffService');
          await initiateHandoff(conversationId, {
            id:          conv.lead.id,
            phone:       conv.lead.phone,
            temperature: conv.lead.temperature,
            storeId:     conv.storeId,
            region:      conv.lead.region,
          });
          output = { handoffInitiated: true };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      // ── Tags e campos ─────────────────────────────────────────────────────────
      case 'SET_TAG': {
        if (leadId && config.tagName) {
          let tag = await prisma.tag.findFirst({ where: { name: config.tagName } });
          if (!tag) tag = await prisma.tag.create({ data: { name: config.tagName } });
          await prisma.leadTag.upsert({
            where:  { leadId_tagId: { leadId, tagId: tag.id } },
            update: {},
            create: { leadId, tagId: tag.id },
          });
          output = { tagApplied: config.tagName };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'REMOVE_TAG': {
        if (leadId && config.tagName) {
          const tag = await prisma.tag.findFirst({ where: { name: config.tagName } });
          if (tag) await prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } });
          output = { tagRemoved: config.tagName };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'SET_FIELD': {
        if (leadId && config.fieldKey && config.value) {
          const field = await prisma.customField.findUnique({ where: { key: config.fieldKey } });
          if (field) {
            await prisma.customFieldValue.upsert({
              where:  { customFieldId_leadId: { customFieldId: field.id, leadId } },
              update: { value: config.value },
              create: { customFieldId: field.id, leadId, value: config.value },
            });
          }
          output = { fieldSet: config.fieldKey, value: config.value };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      // ── Atribuições ───────────────────────────────────────────────────────────
      case 'ASSIGN_USER': {
        if (config.userId) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data:  { assignedUserId: config.userId, mode: 'HUMANO', aiEnabled: false },
          });
          if (leadId) {
            await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: config.userId } });
          }
          output = { assignedTo: config.userId };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'ASSIGN_STORE': {
        if (config.storeId) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data:  { storeId: config.storeId },
          });
          if (leadId) {
            await prisma.lead.update({ where: { id: leadId }, data: { storeId: config.storeId } });
          }
          output = { assignedStore: config.storeId };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      // ── IA on/off ─────────────────────────────────────────────────────────────
      case 'PAUSE_AI': {
        await prisma.conversation.update({
          where: { id: conversationId },
          data:  { aiEnabled: false, mode: 'HUMANO' },
        });
        output = { aiPaused: true };
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'RESUME_AI': {
        await prisma.conversation.update({
          where: { id: conversationId },
          data:  { aiEnabled: true, mode: 'IA_AUTOMATICA' },
        });
        output = { aiResumed: true };
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      // ── Condição ──────────────────────────────────────────────────────────────
      case 'CONDITION': {
        const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;

        // Suporte a regras múltiplas ou condição simples
        const rules = config.rules?.length
          ? config.rules
          : [{ field: config.field, operator: config.operator, value: config.value, nextNodeId: null }];

        let matched = false;
        for (const rule of rules) {
          if (evaluateCondition(rule, lead, userInput)) {
            nextNodeId = rule.nextNodeId || getNextNode(flow.edges, nodeId);
            matched    = true;
            output     = { conditionMet: true, rule };
            break;
          }
        }

        if (!matched) {
          nextNodeId = config.defaultNextNodeId || getNextNode(flow.edges, nodeId);
          output     = { conditionMet: false };
        }
        break;
      }

      // ── Delay ─────────────────────────────────────────────────────────────────
      case 'DELAY': {
        const amount = Number(config.delay ?? 0);
        const unitMs = config.unit === 'hours' ? 3_600_000
                     : config.unit === 'days'  ? 86_400_000
                     : 60_000; // minutes (default)
        const delayMs = amount * unitMs;

        if (!testMode && delayMs > 0) {
          if (delayMs <= 300_000) {
            // Até 5 minutos: aguarda de verdade
            await new Promise(resolve => setTimeout(resolve, delayMs));
            output = { delay: amount, unit: config.unit, waited: true };
          } else {
            // Mais de 5 min: registra e avança (agendamento real exige job queue)
            console.log(`[FLOW_DELAY] delay de ${amount}${config.unit} maior que 5min — avançando sem esperar`);
            output = { delay: amount, unit: config.unit, waited: false, skipped: 'too_long' };
          }
        } else {
          output = { delay: amount, unit: config.unit, waited: false, testMode };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      // ── Webhook externo ───────────────────────────────────────────────────────
      case 'WEBHOOK': {
        if (testMode) {
          output    = { mocked: true, url: config.url };
          nextNodeId = getNextNode(flow.edges, nodeId);
          break;
        }
        try {
          const axios  = require('axios');
          const method = (config.method || 'POST').toLowerCase();
          const resp   = await axios[method](config.url, config.body || {}, {
            headers: config.headers || {},
            timeout: 10_000,
          });
          output = { status: resp.status, response: resp.data };
        } catch (e: any) {
          output = { error: e.message };
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      default:
        console.warn(`[FLOW] Tipo de nó desconhecido: "${node.type}" — avançando`);
        nextNodeId = getNextNode(flow.edges, nodeId);
    }

    await prisma.flowExecutionStep.update({
      where: { id: step.id },
      data:  { status: 'completed', output: JSON.stringify(output) },
    });

  } catch (err: any) {
    await prisma.flowExecutionStep.update({
      where: { id: step.id },
      data:  { status: 'failed', error: err.message },
    }).catch(() => {});
    throw err;
  }

  // Continua para o próximo nó (se não estiver aguardando resposta)
  if (nextNodeId) {
    const exec = await prisma.flowExecution.findUnique({ where: { id: executionId } });
    if (exec?.status === 'RUNNING') {
      await executeNode(executionId, nextNodeId, flow, conversationId, leadId, depth + 1, testMode, undefined);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNextNode(edges: any[], sourceNodeId: string): string | null {
  const edge = edges.find((e: any) => e.sourceNodeId === sourceNodeId);
  return edge?.targetNodeId || null;
}

function evaluateCondition(rule: any, lead: any, userInput?: string): boolean {
  // Campo especial: resposta do usuário à QUESTION anterior
  const fieldValue = rule.field === 'userInput'
    ? userInput ?? ''
    : (lead as any)?.[rule.field] ?? '';

  const val      = String(fieldValue ?? '').toLowerCase();
  const expected = String(rule.value  ?? '').toLowerCase();

  switch (rule.operator) {
    case 'equals':       return val === expected;
    case 'not_equals':   return val !== expected;
    case 'contains':     return val.includes(expected);
    case 'not_contains': return !val.includes(expected);
    case 'starts_with':  return val.startsWith(expected);
    case 'ends_with':    return val.endsWith(expected);
    case 'greater_than': return parseFloat(val) > parseFloat(expected);
    case 'less_than':    return parseFloat(val) < parseFloat(expected);
    case 'exists':       return val.length > 0;
    case 'not_exists':   return val.length === 0;
    // aliases legados
    case 'gt':           return parseFloat(val) > parseFloat(expected);
    case 'lt':           return parseFloat(val) < parseFloat(expected);
    default:             return false;
  }
}
