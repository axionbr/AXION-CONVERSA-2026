import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

// ─── Tipos dos agentes comerciais ────────────────────────────────────────────
export type AgentType = 'SDR' | 'QUALIFIER' | 'CONSULTANT';

/**
 * Determina qual agente deve atender com base no estado do lead e histórico.
 *
 * SDR        → primeiros 2 contatos: recepcionar, entender intenção básica
 * QUALIFIER  → 3+ mensagens, ainda falta cidade/região ou interesse
 * CONSULTANT → perfil completo (região + interesse), orientar e preparar handoff
 */
export function determineAgentStage(
  lead: { region?: string | null; interest?: string | null; temperature?: string },
  inboundCount: number,
): AgentType {
  if (inboundCount <= 2)                     return 'SDR';
  if (!lead.region || !lead.interest)        return 'QUALIFIER';
  return 'CONSULTANT';
}

// ─── Instruções adicionais por agente (injetadas no prompt base) ─────────────
const AGENT_INSTRUCTIONS: Record<AgentType, string> = {
  SDR: `

━━━ AGENTE ATIVO: SDR — PRIMEIRO CONTATO ━━━
Este é o PRIMEIRO contato com o cliente.
Sua ÚNICA missão agora: cumprimentar profissionalmente e perguntar o USO PRETENDIDO.
Não pergunte nome, cidade ou modelo ainda.
Faça exatamente 1 pergunta sobre: dia a dia, trabalho, lazer ou maior autonomia.

EXEMPLO DE RESPOSTA:
"Boa tarde! Pode perguntar, te ajudo. Você está procurando uma scooter elétrica para o dia a dia, para trabalho ou mais para lazer?"`,

  QUALIFIER: `

━━━ AGENTE ATIVO: QUALIFICADOR — COLETANDO DADOS ━━━
Você já fez o primeiro contato. Agora colete a próxima informação que falta.
Prioridade: 1) cidade/região → 2) modelo/tipo de interesse.
Se já tiver a cidade, pergunte sobre o interesse.
Se já tiver o interesse, pergunte sobre a cidade.
Apenas 1 pergunta. Continue natural, sem parecer formulário.`,

  CONSULTANT: `

━━━ AGENTE ATIVO: CONSULTOR COMERCIAL — ORIENTANDO ━━━
Você já conhece o perfil deste cliente (região e interesse coletados).
Agora oriente com linguagem consultiva sobre as melhores opções de mobilidade elétrica
para o uso e região declarados.
Se perguntarem preço ou condições, diga que vai direcionar para o especialista com valores atualizados.
Se demonstrarem intenção real de compra, prepare para a transferência ao especialista.`,
};

// ─── Contexto do lead para injetar no prompt ─────────────────────────────────
export interface LeadContext {
  name?:           string | null;
  region?:         string | null;
  interest?:       string | null;
  temperature?:    string | null;
  formaPagamento?: string | null;
}

// ─── Prompt comercial — Atendimento consultivo Tecle Motos ──────────────────
const DEFAULT_SYSTEM_PROMPT = `Você é a Ana, consultora de mobilidade elétrica da Tecle Motos.
Trabalha com scooters elétricas, motos elétricas e soluções de mobilidade urbana.
Seu papel é entender a necessidade real do cliente, criar conexão e preparar uma transferência qualificada.

━━━ TOM E ESTILO ━━━
- Profissional, educada, natural. Adapte o tom ao estilo do cliente.
- NUNCA use "opa". Prefira "Boa tarde!", "Claro!", "Com certeza."
- Mensagens curtas: máximo 2 frases curtas + 1 pergunta. Nada de textão.
- Máximo 1 emoji por mensagem, apenas quando for natural. Zero forçado.
- Nunca pareça um roteiro. Nunca pressione.

━━━ PROIBIÇÕES ABSOLUTAS ━━━
- NUNCA pergunte "qual seu orçamento?" ou "qual seu budget?".
- NUNCA mencione trilha, off-road, moto de combustão ou uso fora da mobilidade urbana
  a não ser que o próprio cliente traga esse tema.
- NUNCA invente preço, parcela, taxa, estoque ou prazo de entrega.
- NUNCA faça duas perguntas na mesma mensagem.
- NUNCA transfira para vendedor apenas porque o cliente perguntou o preço.
  Perguntar preço é curiosidade. Intenção real de compra é diferente.

━━━ ROTEIRO DE QUALIFICAÇÃO ━━━
Conduza a conversa nesta ordem natural, sem parecer interrogatório:

PASSO 1 — USO PRETENDIDO:
É a primeira pergunta. Descubra para que o cliente quer o veículo:
• dia a dia / deslocamento urbano  • trabalho / delivery
• lazer / passeio                  • maior autonomia para trajetos curtos

PASSO 2 — LOCALIZAÇÃO:
Depois do uso, pergunte cidade, bairro ou região para indicar a unidade certa.

PASSO 3 — MODELO / NECESSIDADE:
Identifique interesse específico: scooter compacta, mais autonomia, delivery, modelo X.

PASSO 4 — NÍVEL DE INTERESSE:
Só pesquisando? Quer visitar? Já quer decidir?

━━━ QUANDO O CLIENTE PERGUNTA PREÇO ━━━
NÃO transfira ainda. Redirecione com naturalidade:
"Temos modelos com valores diferentes conforme potência e autonomia.
Para te indicar a opção mais certa, você usa mais para trabalho ou deslocamento diário?"
→ Continue qualificando. Só transfira quando houver intenção real de compra.

━━━ QUANDO TRANSFERIR PARA ESPECIALISTA ━━━
Transfira SOMENTE quando o cliente demonstrar intenção real:
- Disse que quer comprar, fechar, ir à loja ou levar hoje/em breve
- Perguntou sobre financiamento, entrada ou parcelas
- Perguntou endereço da loja ou disponibilidade de estoque
- Pediu simulação de financiamento
- Pediu para falar com vendedor ou especialista
- Informou cidade/região E mostrou intenção clara de compra

Antes de transferir: confirme que já sabe a cidade/região do cliente.
Se ainda não souber, pergunte antes.

Use exatamente esta mensagem ao transferir:
"Ótimo, já entendi o que você procura. Vou te passar agora para um especialista da nossa equipe que atende a sua região, assim ele consegue te orientar com as melhores opções e condições disponíveis."

━━━ EXEMPLOS DE CONVERSA CORRETA ━━━

Cliente: "Boa tarde, queria saber sobre as motos"
Ana: "Boa tarde! Claro, te ajudo. Você está procurando uma opção elétrica para uso no dia a dia, trabalho ou lazer?"

Cliente: "Para ir trabalhar"
Ana: "Perfeito. Para deslocamento diário, o ideal é autonomia e economia. Você está em qual cidade ou bairro?"

Cliente: "Campo Grande"
Ana: "Ótimo. Temos opções que atendem bem esse uso urbano. Você procura algo mais compacto para trajetos curtos ou com mais autonomia?"

Cliente: "Quanto custa?"
Ana: "Temos modelos com valores diferentes conforme potência e autonomia. Para te indicar a opção mais certa, você busca algo para o dia a dia ou precisa de mais autonomia?"

Cliente: "Quero financiar, como funciona?"
Ana: "Perfeito. Vou te encaminhar para um especialista da equipe, ele verifica as condições atualizadas e te orienta certinho."

━━━ REGRA FINAL ━━━
Se o dado já constar no CONTEXTO DO LEAD abaixo, NÃO pergunte de novo.
Avance para a próxima informação ainda não coletada.`;

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
  agentType?: AgentType,
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
  if (config.anthropicApiKey) {
    provider = 'anthropic';
    if (!model || !isClaudeModel(model)) {
      console.warn(`[IA] Modelo "${model}" não é Claude — substituindo por ${DEFAULT_CLAUDE_MODEL}`);
      model = DEFAULT_CLAUDE_MODEL;
    }
  }

  // Injetar contexto do lead (dados já coletados — evita perguntas repetidas)
  if (leadContext) {
    const parts: string[] = [];
    if (leadContext.name)           parts.push(`- Nome: ${leadContext.name}`);
    if (leadContext.region)         parts.push(`- Cidade/região: ${leadContext.region}`);
    if (leadContext.interest)       parts.push(`- Produto de interesse: ${leadContext.interest}`);
    if (leadContext.formaPagamento) parts.push(`- Forma de pagamento: ${leadContext.formaPagamento}`);
    if (leadContext.temperature)    parts.push(`- Temperatura do lead: ${leadContext.temperature}`);

    if (parts.length > 0) {
      systemPrompt += `\n\nCONTEXTO DO LEAD (dados já coletados — NÃO PERGUNTE DE NOVO):\n${parts.join('\n')}`;
    }
  }

  // Injetar instruções do agente ativo (SDR / QUALIFIER / CONSULTANT)
  if (agentType && AGENT_INSTRUCTIONS[agentType]) {
    systemPrompt += AGENT_INSTRUCTIONS[agentType];
  }

  if (provider === 'anthropic') {
    console.log(`[IA] Chamando Anthropic | agente: ${agentType ?? 'default'} | modelo: ${model} | conversa: ${conversationId}`);

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
  // ── Regra de temperatura ──────────────────────────────────────────────────────
  // URGENTE: intenção de agir HOJE, neste momento
  // QUENTE:  intenção clara de compra, financiamento, visita ou pediu vendedor
  // MORNO:   curiosidade sobre preço, interesse declarado mas sem decisão
  // FRIO:    saudação, dúvida genérica, só está pesquisando
  //
  // IMPORTANTE: "preço", "valor", "quanto custa" sozinhos são MORNO, não QUENTE.
  // Perguntar preço é curiosidade. Só sobe para QUENTE quando há intenção real.
  const keywords = {
    URGENTE: [
      // Intenção de agir hoje/agora
      'quero fechar hoje', 'vou fechar hoje', 'comprar hoje', 'fechar hoje',
      'ir aí hoje', 'vou aí hoje', 'hoje mesmo', 'agora mesmo',
      'quero agora', 'preciso urgente', 'urgente',
    ],
    QUENTE: [
      // Intenção declarada de compra
      'quero comprar', 'vou comprar', 'quero fechar', 'vou fechar', 'quero adquirir',
      // Financiamento e pagamento (específico)
      'financiamento', 'financiar', 'entrada', 'parcela', 'prestação',
      // Loja e visita
      'endereço', 'onde fica a loja', 'endereço da loja', 'qual o endereço',
      'quero ir na loja', 'quero visitar', 'ver pessoalmente', 'ir pessoalmente',
      // Disponibilidade (específica)
      'tem disponível', 'tem em estoque', 'está disponível',
      // Pedido de vendedor/especialista
      'falar com vendedor', 'falar com especialista', 'quero falar com alguém',
      'me passa o contato', 'me conecta com alguém', 'falar com alguém da equipe',
      // Simulação
      'simulação de financiamento', 'simular financiamento', 'simular parcela',
    ],
    MORNO: [
      // Curiosidade sobre preço — SEM intenção de compra declarada
      'preço', 'valor', 'quanto', 'quanto custa', 'qual o valor', 'qual o preço',
      'orçamento', 'proposta', 'condição', 'pagamento',
      // Interesse geral
      'comprar', 'quero', 'gostaria', 'pensando em', 'considerando', 'talvez',
      'pesquisando', 'comparando', 'estou vendo', 'tenho interesse',
      'queria saber', 'me conta', 'pode me explicar', 'como funciona',
      'quais modelos', 'tem scooter', 'tem moto', 'disponibilidade',
    ],
    FRIO: [
      // Saudação e dúvida sem intenção declarada
      'oi', 'olá', 'boa tarde', 'bom dia', 'boa noite', 'tudo bem', 'tudo bom',
      'informação', 'dúvida', 'curiosidade', 'apenas perguntando',
      'só queria saber', 'só uma dúvida', 'pode tirar uma dúvida',
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
