import { PrismaClient } from '@prisma/client';
import { generateAiResponse } from './aiService';
import { sendTextMessage } from './zapiService';
import { emitNewMessage } from '../socket';

const prisma = new PrismaClient();

export async function triggerFlowsByEvent(
  eventType: string,
  value: string,
  conversationId: string,
  leadId: string
) {
  const triggers = await prisma.flowTrigger.findMany({
    where: { type: eventType as any, active: true },
    include: { flow: { include: { nodes: true, edges: true } } },
  });

  if (triggers.length === 0) return;

  for (const trigger of triggers) {
    if (!trigger.flow.active) continue;

    if (eventType === 'KEYWORD' && trigger.value) {
      const keyword = trigger.value.toLowerCase();
      if (!value.toLowerCase().includes(keyword)) continue;
    }

    try {
      await executeFlow(trigger.flow.id, conversationId, leadId);
      await prisma.automationLog.create({
        data: {
          type:           'FLOW_EVENT_TRIGGERED',
          description:    `Fluxo "${trigger.flow.name}" disparado por evento ${eventType}`,
          data:           JSON.stringify({ eventType, value: value.substring(0, 100), flowId: trigger.flow.id }),
          conversationId,
          leadId,
        },
      }).catch(() => {});
    } catch (flowErr: any) {
      console.error(`[FLOW_EVENT_FAILED] | evento: ${eventType} | fluxo: ${trigger.flow.id} | erro:`, flowErr.message);
      await prisma.automationLog.create({
        data: {
          type:           'FLOW_EVENT_FAILED',
          description:    `Falha ao executar fluxo "${trigger.flow.name}": ${flowErr.message}`,
          data:           JSON.stringify({ eventType, flowId: trigger.flow.id, error: flowErr.message }),
          conversationId,
          leadId,
        },
      }).catch(() => {});
    }
  }
}

export async function executeFlow(
  flowId: string,
  conversationId: string,
  leadId?: string
) {
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: { nodes: true, edges: true },
  });

  if (!flow || !flow.active) return;

  const startNode = flow.nodes.find(n => n.type === 'START');
  if (!startNode) return;

  const execution = await prisma.flowExecution.create({
    data: {
      flowId,
      conversationId,
      leadId,
      status: 'RUNNING',
      currentNodeId: startNode.id,
    },
  });

  try {
    await executeNode(execution.id, startNode.id, flow, conversationId, leadId);
    await prisma.flowExecution.update({
      where: { id: execution.id },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
  } catch (err: any) {
    await prisma.flowExecution.update({
      where: { id: execution.id },
      data: { status: 'FAILED', error: err.message, finishedAt: new Date() },
    });
  }
}

async function executeNode(
  executionId: string,
  nodeId: string,
  flow: any,
  conversationId: string,
  leadId?: string,
  depth = 0
): Promise<void> {
  if (depth > 50) throw new Error('Flow loop detected');

  const node = flow.nodes.find((n: any) => n.id === nodeId);
  if (!node) return;

  await prisma.flowExecution.update({
    where: { id: executionId },
    data: { currentNodeId: nodeId },
  });

  const stepData: any = { executionId, nodeId, status: 'running', input: '{}' };
  const step = await prisma.flowExecutionStep.create({ data: stepData });

  let nextNodeId: string | null = null;
  let output: any = {};

  try {
    const config: any = typeof node.config === 'string'
      ? JSON.parse(node.config || '{}')
      : (node.config as any) || {};

    switch (node.type) {
      case 'START': {
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'MESSAGE': {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { contact: true },
        });

        if (conversation && config.text) {
          const msg = await prisma.message.create({
            data: {
              conversationId,
              direction:  'OUTBOUND',
              type:       'TEXT',
              content:    config.text,
              senderType: 'FLOW',
              fromFlow:   true,
              flowNodeId: nodeId,
            },
          });

          // contact.phone é normalizado (sem DDI); Z-API precisa do "55" prefixado
          const zapiPhone = `55${conversation.contact.phone}`;
          await sendTextMessage(zapiPhone, config.text, conversation.storeId).catch(
            (e: any) => console.error('Flow Z-API error:', e.message)
          );

          emitNewMessage(conversationId, {
            id: msg.id,
            conversationId,
            direction: 'OUTBOUND',
            type: 'TEXT',
            content: config.text,
            createdAt: msg.createdAt.toISOString(),
            fromFlow: true,
          });
        }

        nextNodeId = getNextNode(flow.edges, nodeId);
        output = { sent: config.text };
        break;
      }

      case 'AI_RESPONSE': {
        const recentMessages = await prisma.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: 15,
        });

        const chatHistory = recentMessages.map((m: any) => ({
          role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        }));

        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { contact: true },
        });

        const aiReply = await generateAiResponse(conversationId, chatHistory, conversation?.storeId);

        if (aiReply && conversation) {
          const msg = await prisma.message.create({
            data: {
              conversationId,
              direction:  'OUTBOUND',
              type:       'TEXT',
              content:    aiReply,
              senderType: 'AI',
              fromFlow:   true,
              flowNodeId: nodeId,
            },
          });

          // contact.phone é normalizado (sem DDI); Z-API precisa do "55" prefixado
          const zapiPhone = `55${conversation.contact.phone}`;
          await sendTextMessage(zapiPhone, aiReply, conversation.storeId).catch(
            (e: any) => console.error('Flow Z-API error:', e.message)
          );

          emitNewMessage(conversationId, {
            id: msg.id,
            conversationId,
            direction: 'OUTBOUND',
            type: 'TEXT',
            content: aiReply,
            createdAt: msg.createdAt.toISOString(),
            fromFlow: true,
          });
        }

        nextNodeId = getNextNode(flow.edges, nodeId);
        output = { aiReply };
        break;
      }

      case 'SET_TAG': {
        if (leadId && config.tagName) {
          let tag = await prisma.tag.findFirst({ where: { name: config.tagName } });
          if (!tag) tag = await prisma.tag.create({ data: { name: config.tagName } });

          await prisma.leadTag.upsert({
            where: { leadId_tagId: { leadId, tagId: tag.id } },
            update: {},
            create: { leadId, tagId: tag.id },
          });
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'REMOVE_TAG': {
        if (leadId && config.tagName) {
          const tag = await prisma.tag.findFirst({ where: { name: config.tagName } });
          if (tag) {
            await prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } });
          }
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'SET_FIELD': {
        if (leadId && config.fieldKey && config.value) {
          const field = await prisma.customField.findUnique({ where: { key: config.fieldKey } });
          if (field) {
            await prisma.customFieldValue.upsert({
              where: { customFieldId_leadId: { customFieldId: field.id, leadId } },
              update: { value: config.value },
              create: { customFieldId: field.id, leadId, value: config.value },
            });
          }
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'ASSIGN_USER': {
        if (config.userId) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { assignedUserId: config.userId, mode: 'HUMANO', aiEnabled: false },
          });
          if (leadId) {
            await prisma.lead.update({ where: { id: leadId }, data: { assignedUserId: config.userId } });
          }
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'ASSIGN_STORE': {
        if (config.storeId) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { storeId: config.storeId },
          });
          if (leadId) {
            await prisma.lead.update({ where: { id: leadId }, data: { storeId: config.storeId } });
          }
        }
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'PAUSE_AI': {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { aiEnabled: false, mode: 'HUMANO' },
        });
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'RESUME_AI': {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { aiEnabled: true, mode: 'IA_AUTOMATICA' },
        });
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'CONDITION': {
        const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;
        const rules = config.rules || [];

        let matched = false;
        for (const rule of rules) {
          if (evaluateCondition(rule, lead)) {
            nextNodeId = rule.nextNodeId;
            matched = true;
            break;
          }
        }

        if (!matched) nextNodeId = config.defaultNextNodeId || getNextNode(flow.edges, nodeId);
        break;
      }

      case 'DELAY': {
        // V1: log delay, skip actual waiting
        output = { delay: config.delay, unit: config.unit };
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'WEBHOOK': {
        const axios = require('axios');
        const method = (config.method || 'POST').toLowerCase();
        const resp = await axios[method](config.url, config.body || {}, {
          headers: config.headers || {},
        }).catch((e: any) => ({ data: { error: e.message } }));
        output = { response: resp.data };
        nextNodeId = getNextNode(flow.edges, nodeId);
        break;
      }

      case 'END': {
        nextNodeId = null;
        break;
      }

      default:
        nextNodeId = getNextNode(flow.edges, nodeId);
    }

    await prisma.flowExecutionStep.update({
      where: { id: step.id },
      data: { status: 'completed', output: JSON.stringify(output) },
    });
  } catch (err: any) {
    await prisma.flowExecutionStep.update({
      where: { id: step.id },
      data: { status: 'failed', error: err.message },
    });
    throw err;
  }

  if (nextNodeId) {
    await executeNode(executionId, nextNodeId, flow, conversationId, leadId, depth + 1);
  }
}

function getNextNode(edges: any[], sourceNodeId: string): string | null {
  const edge = edges.find((e: any) => e.sourceNodeId === sourceNodeId);
  return edge?.targetNodeId || null;
}

function evaluateCondition(rule: any, lead: any): boolean {
  if (!lead || !rule.field) return false;
  const value = (lead as any)[rule.field];
  switch (rule.operator) {
    case 'equals': return value === rule.value;
    case 'not_equals': return value !== rule.value;
    case 'contains': return String(value).includes(rule.value);
    case 'gt': return Number(value) > Number(rule.value);
    case 'lt': return Number(value) < Number(rule.value);
    default: return false;
  }
}
