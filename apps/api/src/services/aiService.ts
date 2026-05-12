import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

// ─── Contexto do lead para injetar no prompt ─────────────────────────────────
export interface LeadContext {
  name?:           string | null;
  region?:         string | null;
  interest?:       string | null;
  temperature?:    string | null;
  formaPagamento?: string | null;
}

// ─── Prompt comercial — SDR/Consultora Tecle Motos ───────────────────────────
const DEFAULT_SYSTEM_PROMPT = `Você é a Ana, consultora comercial da Tecle Motos, especialista em scooters e motos elétricas.

COMO ATENDER:
- Seja natural e simpática. Nunca pareça um robô ou roteiro.
- Faça UMA pergunta de cada vez.
- Mensagens curtas: máximo 2-3 frases. Nunca envie textão.
- Nunca invente preço, estoque, prazo ou condição de pagamento.
- Se não souber: "Vou confirmar com nossa equipe e já te retorno 😊"
- Use o nome do cliente assim que souber.
- Emoji discreto, apenas quando natural (máximo 1 por mensagem).
- Linguagem brasileira informal e amigável.

QUALIFICAÇÃO (de forma natural, sem parecer interrogatório):
Colete estas informações na ordem que surgir naturalmente na conversa:
1. Nome do cliente — se ainda não se apresentou
2. Cidade, bairro ou região — para indicar a unidade mais próxima
3. Modelo ou tipo de interesse — scooter elétrica, moto elétrica, qual modelo, uso para delivery?
4. Urgência — só está pesquisando, quer comprar em breve, ou quer visitar a loja?
5. Pagamento — à vista, cartão, financiamento, consórcio

REGRA DE OURO: Se o dado já foi coletado (consta no CONTEXTO DO LEAD abaixo), NÃO pergunte de novo.
Passe para a próxima informação ainda não coletada.

QUANDO TRANSFERIR PARA ESPECIALISTA:
Quando o cliente demonstrar intenção clara de compra, pediu preço, parcela, financiamento,
endereço da loja, disponibilidade de estoque, ou disse que quer visitar, fechar ou comprar agora.
Não transfira antes de saber pelo menos a cidade/região do cliente.

Conduza com naturalidade. Seja consultivo e acolhedor. Nunca pressione.
Seu objetivo é entender a necessidade do cliente e conectá-lo ao especialista certo.`;

/** Retorna true se o modelo pertence ao Claude/Anthropic. */
function isClaudeModel(model: string): boolean {
  return model.startsWith('claude-') || model.startsWith('claude3');
}

// ─── Carrega AiConfig: 1) por loja, 2) global (storeId null), 3) env ─────────
async function loadAiConfig(storeId?: string | null): Promise<{
  provider:     string;
  model:        string;
  systemPrompt: string | null;
  temperature:  number;
  maxTokens:    number;
} | null> {
  // Tenta config específica da loja
  if (storeId) {
    const cfg = await prisma.aiConfig.findUnique({ where: { storeId } });
    if (cfg) return cfg;
  }
  // Fallback: config global (sem loja)
  const global = await prisma.aiConfig.findFirst({ where: { storeId: null } });
  return global ?? null;
}

export async function generateAiResponse(
  conversationId: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  storeId?: string | null,
  leadContext?: LeadContext,
): Promise<string> {
  let provider     = config.aiProvider;
  let model        = config.aiModel;
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  let temperature  = 0.7;
  let maxTokens    = 500;

  // Carregar configuração do banco (loja → global → env)
  const dbConfig = await loadAiConfig(storeId);
  if (dbConfig) {
    provider     = dbConfig.provider as 'openai' | 'anthropic';
    model        = dbConfig.model;
    if (dbConfig.systemPrompt) systemPrompt = dbConfig.systemPrompt;
    temperature  = dbConfig.temperature;
    maxTokens    = dbConfig.maxTokens;
  }

  // ── REGRA ABSOLUTA: se ANTHROPIC_API_KEY estiver configurada, SEMPRE usar Anthropic ──
  // Ignora qualquer valor de provider que possa estar salvo no banco (ex: 'openai' antigo).
  if (config.anthropicApiKey) {
    provider = 'anthropic';
    if (!model || !isClaudeModel(model)) {
      console.warn(`[IA] Modelo "${model}" não é Claude — substituindo por ${DEFAULT_CLAUDE_MODEL}`);
      model = DEFAULT_CLAUDE_MODEL;
    }
  }

  // Injetar contexto do lead no prompt para evitar perguntas repetidas
  if (leadContext) {
    const parts: string[] = [];
    if (leadContext.name)           parts.push(`- Nome: ${leadContext.name}`);
    if (leadContext.region)         parts.push(`- Cidade/região: ${leadContext.region}`);
    if (leadContext.interest)       parts.push(`- Produto de interesse: ${leadContext.interest}`);
    if (leadContext.formaPagamento) parts.push(`- Forma de pagamento: ${leadContext.formaPagamento}`);
    if (leadContext.temperature)    parts.push(`- Temperatura do lead: ${leadContext.temperature}`);

    if (parts.length > 0) {
      systemPrompt += `\n\nCONTEXTO DO LEAD (dados já coletados — NÃO PERGUNTE DE NOVO):\n${parts.join('\n')}\n\nAvance para a próxima informação da qualificação que ainda não foi coletada.`;
    }
  }

  if (provider === 'anthropic') {
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
    // OpenAI — só chega aqui se ANTHROPIC_API_KEY não estiver configurada
    const openAiModel = isClaudeModel(model) ? DEFAULT_OPENAI_MODEL : (model || DEFAULT_OPENAI_MODEL);
    console.log(`[IA] Chamando OpenAI | modelo: ${openAiModel} | conversa: ${conversationId}`);

    const client   = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model:      openAiModel,
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
  nomeCliente?:     string | null;
  cidade?:          string | null;
  bairro?:          string | null;
  regiao?:          string | null;
  ddd?:             string | null;
  modeloInteresse?: string | null;
  urgencia?:        'imediata' | 'proximas_semanas' | 'pesquisando' | null;
  formaPagamento?:  'avista' | 'cartao' | 'financiamento' | 'consorcio' | null;
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

  const analysisPrompt = `Analise esta conversa de WhatsApp comercial e retorne um JSON com EXATAMENTE estas chaves:
{
  "tipo": "venda|suporte|orcamento|reclamacao|informacao|outro",
  "temperatura": "FRIO|MORNO|QUENTE|URGENTE",
  "resumo": "resumo em 1-2 frases do que o cliente quer ou precisa",
  "proximaAcao": "acao específica e objetiva que o atendente deve fazer agora",
  "respostaSugerida": "mensagem pronta para responder ao cliente, natural, cordial, em português do Brasil",
  "nomeCliente": "nome do cliente se mencionado, caso contrário null",
  "cidade": "cidade mencionada ou inferida, caso contrário null",
  "bairro": "bairro mencionado, caso contrário null",
  "regiao": "região, estado ou área geográfica identificada, caso contrário null",
  "ddd": "DDD identificado no número ou na conversa, caso contrário null",
  "modeloInteresse": "modelo ou tipo de veículo de interesse mencionado, caso contrário null",
  "urgencia": "imediata|proximas_semanas|pesquisando|null",
  "formaPagamento": "avista|cartao|financiamento|consorcio|null"
}

REGRAS:
- RESPONDA APENAS COM O JSON. SEM MARKDOWN. SEM TEXTO ADICIONAL.
- Para campos não identificados, use null (não use string vazia).
- temperatura QUENTE: cliente perguntou preço, financiamento, disponibilidade, endereço, quer comprar agora ou disse "quero fechar"
- temperatura URGENTE: cliente disse "agora", "hoje", "urgente", "vou aí hoje"

Conversa:
${historyText}`;

  // ── REGRA ABSOLUTA: se ANTHROPIC_API_KEY existir, usar Claude ────────────────
  if (config.anthropicApiKey) {
    // Resolver modelo (loja → global → env), sempre validando que é Claude
    let model = DEFAULT_CLAUDE_MODEL;
    const dbConfig = await loadAiConfig(storeId);
    if (dbConfig?.model && isClaudeModel(dbConfig.model)) {
      model = dbConfig.model;
    } else if (config.aiModel && isClaudeModel(config.aiModel)) {
      model = config.aiModel;
    }

    try {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      const resp = await client.messages.create({
        model,
        max_tokens: 600,
        messages: [{ role: 'user', content: analysisPrompt }],
      });
      const block = resp.content[0];
      const raw   = block.type === 'text' ? block.text.trim() : '';
      // Remover possível markdown que Claude pode incluir
      const clean = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(clean) as ConversationAnalysis;
      console.log(`[IA] Análise Claude concluída | modelo: ${model}`);
      return parsed;
    } catch (e: any) {
      console.warn('[IA] Claude falhou na análise, usando fallback por palavras-chave:', e.message);
    }
  }

  // Fallback por palavras-chave (sem chamada de IA externa)
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
    resumo: lastClientMsg
      ? `Cliente enviou: "${lastClientMsg.content.substring(0, 80)}"`
      : 'Sem mensagens do cliente',
    proximaAcao: temperature === 'URGENTE' ? 'Atender imediatamente — lead urgente'
               : temperature === 'QUENTE'  ? 'Entrar em contato rapidamente — interesse alto'
               : 'Responder ao cliente e qualificar necessidade',
    respostaSugerida: 'Olá! Obrigado por entrar em contato. Como posso te ajudar hoje?',
    nomeCliente:     null,
    cidade:          null,
    bairro:          null,
    regiao:          null,
    ddd:             null,
    modeloInteresse: null,
    urgencia:        null,
    formaPagamento:  null,
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
      'comprar', 'fechar', 'quanto', 'preço', 'valor', 'parcela', 'financiamento',
      'entrada', 'prestação', 'orçamento', 'proposta', 'condição', 'pagamento',
      'disponível', 'disponibilidade', 'tem estoque', 'tem em estoque',
      'endereço', 'loja', 'onde fica', 'qual endereço', 'visitar', 'ver pessoalmente',
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
    lowerText.includes('preço')    || lowerText.includes('valor')      ? 'consulta_preco'  :
    lowerText.includes('comprar')  || lowerText.includes('fechar')     ? 'intencao_compra' :
    lowerText.includes('dúvida')   || lowerText.includes('informação') ? 'informacao'      :
    'contato_inicial';

  return { intent, temperature, score };
}
