import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

// ─── Prompt comercial padrão — SDR/Consultora Tecle Motos ────────────────────
const DEFAULT_SYSTEM_PROMPT = `Você é a Ana, consultora comercial da Tecle Motos, especialista em scooters e motos elétricas.

COMO ATENDER:
- Seja natural, cordial e objetivo. Nunca pareça um robô.
- Faça UMA pergunta de cada vez.
- Respostas curtas: no máximo 2-3 frases. Evite textos longos.
- Não invente preços, estoque ou condições de pagamento.
- Quando não souber: "Vou confirmar com nossa equipe e já te retorno 😊"
- Use o nome do cliente assim que souber.
- Emoji discreto, apenas quando natural.

O QUE DESCOBRIR (de forma natural, sem parecer interrogatório):
1. Nome do cliente (se ainda não informado)
2. Cidade ou bairro (para indicar a unidade mais próxima)
3. Modelo de interesse (scooter elétrica, moto elétrica, qual modelo)
4. Uso: trabalho, lazer, deslocamento diário, delivery
5. Urgência: está pesquisando ou quer comprar em breve
6. Pagamento: à vista, cartão, financiamento

FLUXO NATURAL:
- Cumprimente e pergunte o nome se não informado
- Entenda o que está procurando
- Pergunte a cidade/região para indicar a loja mais próxima
- Qualifique interesse, uso e urgência progressivamente
- Quando o cliente demonstrar interesse real, prepare para conectar ao especialista

Conduza com naturalidade. Seja consultivo, não robotizado. Nunca pressione.`;

/** Valida se um nome de modelo pertence ao Claude/Anthropic. */
function isClaudeModel(model: string): boolean {
  return model.startsWith('claude-') || model.startsWith('claude3');
}

/** Valida se um nome de modelo pertence ao OpenAI. */
function isOpenAiModel(model: string): boolean {
  return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
}

export async function generateAiResponse(
  conversationId: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  storeId?: string | null,
): Promise<string> {
  let provider   = config.aiProvider;
  let model      = config.aiModel;
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  let temperature  = 0.7;
  let maxTokens    = 500;

  // Sobrescrever com configuração por loja se existir
  if (storeId) {
    const aiConfig = await prisma.aiConfig.findUnique({ where: { storeId } });
    if (aiConfig) {
      provider     = aiConfig.provider as 'openai' | 'anthropic';
      model        = aiConfig.model;
      if (aiConfig.systemPrompt) systemPrompt = aiConfig.systemPrompt;
      temperature  = aiConfig.temperature;
      maxTokens    = aiConfig.maxTokens;
    }
  }

  if (provider === 'anthropic') {
    // Garantir modelo Claude válido — evita enviar "gpt-4o-mini" para a API Anthropic
    if (!model || !isClaudeModel(model)) {
      if (model) {
        console.warn(`[IA] AI_MODEL="${model}" não é um modelo Claude válido — usando ${DEFAULT_CLAUDE_MODEL}`);
      }
      model = DEFAULT_CLAUDE_MODEL;
    }

    console.log(`[IA] Chamando Anthropic | modelo: ${model} | conversa: ${conversationId}`);

    const client   = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   messages.map(m => ({ role: m.role, content: m.content })),
    });

    const block = response.content[0];
    const reply = block.type === 'text' ? block.text.trim() : '';

    if (reply) {
      console.log(`[IA_RESPONSE_GENERATED] | Anthropic | conv: ${conversationId} | len: ${reply.length}`);
    }
    return reply;

  } else {
    // Garantir modelo OpenAI válido
    if (!model || !isOpenAiModel(model)) {
      model = DEFAULT_OPENAI_MODEL;
    }

    console.log(`[IA] Chamando OpenAI | modelo: ${model} | conversa: ${conversationId}`);

    const client   = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    });

    const reply = (response.choices[0]?.message?.content ?? '').trim();

    if (reply) {
      console.log(`[IA_RESPONSE_GENERATED] | OpenAI | conv: ${conversationId} | len: ${reply.length}`);
    }
    return reply;
  }
}

export interface ConversationAnalysis {
  tipo: 'venda' | 'suporte' | 'orcamento' | 'reclamacao' | 'informacao' | 'outro';
  temperatura: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
  resumo: string;
  proximaAcao: string;
  respostaSugerida: string;
}

export async function analyzeConversation(
  messages: Array<{ direction: string; content: string; senderType: string }>,
  storeId?: string | null,
): Promise<ConversationAnalysis> {
  const historyText = messages
    .map(m => {
      const role = m.direction === 'INBOUND' ? '[CLIENTE]' :
                   m.senderType === 'AI'     ? '[IA]'      : '[ATENDENTE]';
      return `${role}: ${m.content}`;
    })
    .join('\n');

  const analysisPrompt = `Analise esta conversa de WhatsApp e retorne um JSON com EXATAMENTE estas chaves:
{
  "tipo": "venda|suporte|orcamento|reclamacao|informacao|outro",
  "temperatura": "FRIO|MORNO|QUENTE|URGENTE",
  "resumo": "resumo em até 2 frases do que o cliente quer",
  "proximaAcao": "acao especifica que o atendente deve fazer agora",
  "respostaSugerida": "mensagem pronta para responder ao cliente em portugues do Brasil, cordial e direta"
}

RESPONDA APENAS COM O JSON. SEM MARKDOWN. SEM TEXTO ADICIONAL.

Conversa:
${historyText}`;

  // Tentar Claude
  if (config.anthropicApiKey) {
    try {
      let provider = 'anthropic';
      let model = config.aiModel || 'claude-haiku-4-5-20251001';

      if (storeId) {
        const aiCfg = await prisma.aiConfig.findUnique({ where: { storeId } });
        if (aiCfg) { provider = aiCfg.provider; model = aiCfg.model; }
      }

      if (provider === 'anthropic' || !config.openaiApiKey) {
        if (!isClaudeModel(model)) model = 'claude-haiku-4-5-20251001';
        const client = new Anthropic({ apiKey: config.anthropicApiKey });
        const resp = await client.messages.create({
          model,
          max_tokens: 600,
          messages: [{ role: 'user', content: analysisPrompt }],
        });
        const block = resp.content[0];
        const raw = block.type === 'text' ? block.text.trim() : '';
        const parsed = JSON.parse(raw) as ConversationAnalysis;
        console.log('[IA] Analise Claude concluida');
        return parsed;
      }
    } catch (e: any) {
      console.warn('[IA] Claude falhou na analise, usando fallback:', e.message);
    }
  }

  // Tentar OpenAI
  if (config.openaiApiKey) {
    try {
      const client = new OpenAI({ apiKey: config.openaiApiKey });
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 600,
        messages: [{ role: 'user', content: analysisPrompt }],
      });
      const raw = (resp.choices[0]?.message?.content ?? '').trim();
      const parsed = JSON.parse(raw) as ConversationAnalysis;
      console.log('[IA] Analise OpenAI concluida');
      return parsed;
    } catch (e: any) {
      console.warn('[IA] OpenAI falhou na analise, usando fallback:', e.message);
    }
  }

  // Fallback por palavras-chave
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  const { temperature } = await classifyIntentAndTemperature(allText);
  const lastClientMsg = [...messages].reverse().find(m => m.direction === 'INBOUND');

  const tipoMap: Record<string, ConversationAnalysis['tipo']> = {
    preco: 'orcamento', valor: 'orcamento', financiamento: 'orcamento',
    comprar: 'venda', fechar: 'venda', pedido: 'venda',
    problema: 'suporte', erro: 'suporte', reclamacao: 'reclamacao',
  };
  let tipo: ConversationAnalysis['tipo'] = 'informacao';
  for (const [kw, t] of Object.entries(tipoMap)) {
    if (allText.includes(kw)) { tipo = t; break; }
  }

  return {
    tipo,
    temperatura: temperature,
    resumo: lastClientMsg ? `Cliente enviou: "${lastClientMsg.content.substring(0, 80)}"` : 'Sem mensagens do cliente',
    proximaAcao: temperature === 'URGENTE' ? 'Atender imediatamente — lead urgente'
               : temperature === 'QUENTE'  ? 'Entrar em contato rapidamente — interesse alto'
               : 'Responder ao cliente e qualificar necessidade',
    respostaSugerida: 'Ola! Obrigado por entrar em contato. Como posso te ajudar hoje?',
  };
}

export async function classifyIntentAndTemperature(text: string): Promise<{
  intent:      string;
  temperature: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
  score:       number;
}> {
  const keywords = {
    URGENTE: [
      'urgente', 'agora', 'hoje', 'preciso muito', 'emergência', 'imediato',
      'quero fechar', 'vou fechar', 'comprar hoje', 'fechar hoje', 'quero agora',
    ],
    QUENTE: [
      // Interesse financeiro
      'comprar', 'fechar', 'quanto', 'preço', 'valor', 'parcela', 'financiamento',
      'entrada', 'prestação', 'orçamento', 'proposta', 'condição', 'pagamento',
      // Disponibilidade / loja
      'disponível', 'disponibilidade', 'tem estoque', 'tem em estoque',
      'endereço', 'loja', 'onde fica', 'qual endereço', 'visitar', 'ver pessoalmente',
      // Intenção de falar com vendedor
      'falar com vendedor', 'falar com especialista', 'quero falar', 'me passa contato',
      'me indica', 'me conecta', 'falar com alguém',
    ],
    MORNO: [
      'interesse', 'quero', 'gostaria', 'pensando', 'considerando', 'talvez',
      'pesquisando', 'comparando', 'estou vendo', 'tenho interesse',
      'queria saber mais', 'me conta mais', 'pode me explicar',
    ],
    FRIO: [
      'informação', 'dúvida', 'curiosidade', 'apenas perguntando', 'só queria saber',
      'só uma dúvida', 'pode tirar uma dúvida',
    ],
  };

  const lowerText = text.toLowerCase();
  let temperature: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE' = 'FRIO';
  let score = 10;

  if (keywords.URGENTE.some(k => lowerText.includes(k))) {
    temperature = 'URGENTE'; score = 90;
  } else if (keywords.QUENTE.some(k => lowerText.includes(k))) {
    temperature = 'QUENTE';  score = 70;
  } else if (keywords.MORNO.some(k => lowerText.includes(k))) {
    temperature = 'MORNO';   score = 40;
  }

  const intent =
    lowerText.includes('preço')    || lowerText.includes('valor')   ? 'consulta_preco'   :
    lowerText.includes('comprar')  || lowerText.includes('fechar')  ? 'intencao_compra'  :
    lowerText.includes('dúvida')   || lowerText.includes('informação') ? 'informacao'    :
    'contato_inicial';

  return { intent, temperature, score };
}
