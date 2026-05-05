import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function generateAiResponse(
  conversationId: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  storeId?: string | null
): Promise<string> {
  let provider = config.aiProvider;
  let model = config.aiModel;
  let systemPrompt = 'Você é um assistente de atendimento ao cliente. Seja cordial, objetivo e prestativo.';
  let temperature = 0.7;
  let maxTokens = 500;

  if (storeId) {
    const aiConfig = await prisma.aiConfig.findUnique({ where: { storeId } });
    if (aiConfig) {
      provider = aiConfig.provider as 'openai' | 'anthropic';
      model = aiConfig.model;
      if (aiConfig.systemPrompt) systemPrompt = aiConfig.systemPrompt;
      temperature = aiConfig.temperature;
      maxTokens = aiConfig.maxTokens;
    }
  }

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  } else {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model: model || 'gpt-4o-mini',
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    });
    return response.choices[0]?.message?.content || '';
  }
}

export async function classifyIntentAndTemperature(text: string): Promise<{
  intent: string;
  temperature: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
  score: number;
}> {
  const keywords = {
    URGENTE: ['urgente', 'agora', 'hoje', 'preciso muito', 'emergência', 'imediato'],
    QUENTE: ['comprar', 'fechar', 'quanto', 'preço', 'valor', 'parcela', 'financiamento', 'disponível'],
    MORNO: ['interesse', 'quero', 'gostaria', 'pensando', 'considerando', 'talvez'],
    FRIO: ['informação', 'dúvida', 'curiosidade', 'apenas perguntando'],
  };

  const lowerText = text.toLowerCase();
  let temperature: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE' = 'FRIO';
  let score = 10;

  if (keywords.URGENTE.some(k => lowerText.includes(k))) {
    temperature = 'URGENTE';
    score = 90;
  } else if (keywords.QUENTE.some(k => lowerText.includes(k))) {
    temperature = 'QUENTE';
    score = 70;
  } else if (keywords.MORNO.some(k => lowerText.includes(k))) {
    temperature = 'MORNO';
    score = 40;
  }

  const intent = lowerText.includes('preço') || lowerText.includes('valor')
    ? 'consulta_preco'
    : lowerText.includes('comprar') || lowerText.includes('fechar')
    ? 'intencao_compra'
    : lowerText.includes('dúvida') || lowerText.includes('informação')
    ? 'informacao'
    : 'contato_inicial';

  return { intent, temperature, score };
}
