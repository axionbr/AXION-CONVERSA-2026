"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiResponse = generateAiResponse;
exports.analyzeConversation = analyzeConversation;
exports.classifyIntentAndTemperature = classifyIntentAndTemperature;
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const config_1 = require("../config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
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
/** Valida se um nome de modelo pertence ao Claude/Anthropic. */
function isClaudeModel(model) {
    return model.startsWith('claude-') || model.startsWith('claude3');
}
/** Valida se um nome de modelo pertence ao OpenAI. */
function isOpenAiModel(model) {
    return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
}
async function generateAiResponse(conversationId, messages, storeId, leadContext) {
    let provider = config_1.config.aiProvider;
    let model = config_1.config.aiModel;
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;
    let temperature = 0.7;
    let maxTokens = 500;
    // Sobrescrever com configuração por loja se existir
    if (storeId) {
        const aiConfig = await prisma.aiConfig.findUnique({ where: { storeId } });
        if (aiConfig) {
            provider = aiConfig.provider;
            model = aiConfig.model;
            if (aiConfig.systemPrompt)
                systemPrompt = aiConfig.systemPrompt;
            temperature = aiConfig.temperature;
            maxTokens = aiConfig.maxTokens;
        }
    }
    // Injetar contexto do lead no prompt para evitar perguntas repetidas
    if (leadContext) {
        const parts = [];
        if (leadContext.name)
            parts.push(`- Nome: ${leadContext.name}`);
        if (leadContext.region)
            parts.push(`- Cidade/região: ${leadContext.region}`);
        if (leadContext.interest)
            parts.push(`- Produto de interesse: ${leadContext.interest}`);
        if (leadContext.formaPagamento)
            parts.push(`- Forma de pagamento: ${leadContext.formaPagamento}`);
        if (leadContext.temperature)
            parts.push(`- Temperatura do lead: ${leadContext.temperature}`);
        if (parts.length > 0) {
            systemPrompt += `\n\nCONTEXTO DO LEAD (dados já coletados — NÃO PERGUNTE DE NOVO):\n${parts.join('\n')}\n\nAvance para a próxima informação da qualificação que ainda não foi coletada.`;
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
        const client = new sdk_1.default({ apiKey: config_1.config.anthropicApiKey });
        const response = await client.messages.create({
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
        });
        const block = response.content[0];
        const reply = block.type === 'text' ? block.text.trim() : '';
        if (reply) {
            console.log(`[IA_RESPONSE_GENERATED] | Anthropic | conv: ${conversationId} | len: ${reply.length}`);
        }
        return reply;
    }
    else {
        // Garantir modelo OpenAI válido
        if (!model || !isOpenAiModel(model)) {
            model = DEFAULT_OPENAI_MODEL;
        }
        console.log(`[IA] Chamando OpenAI | modelo: ${model} | conversa: ${conversationId}`);
        const client = new openai_1.default({ apiKey: config_1.config.openaiApiKey });
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
async function analyzeConversation(messages, storeId) {
    const historyText = messages
        .map(m => {
        const role = m.direction === 'INBOUND' ? '[CLIENTE]' :
            m.senderType === 'AI' ? '[IA]' : '[ATENDENTE]';
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
    // Tentar Claude
    if (config_1.config.anthropicApiKey) {
        try {
            let provider = 'anthropic';
            let model = config_1.config.aiModel || 'claude-haiku-4-5-20251001';
            if (storeId) {
                const aiCfg = await prisma.aiConfig.findUnique({ where: { storeId } });
                if (aiCfg) {
                    provider = aiCfg.provider;
                    model = aiCfg.model;
                }
            }
            if (provider === 'anthropic' || !config_1.config.openaiApiKey) {
                if (!isClaudeModel(model))
                    model = 'claude-haiku-4-5-20251001';
                const client = new sdk_1.default({ apiKey: config_1.config.anthropicApiKey });
                const resp = await client.messages.create({
                    model,
                    max_tokens: 600,
                    messages: [{ role: 'user', content: analysisPrompt }],
                });
                const block = resp.content[0];
                const raw = block.type === 'text' ? block.text.trim() : '';
                const parsed = JSON.parse(raw);
                console.log('[IA] Analise Claude concluida');
                return parsed;
            }
        }
        catch (e) {
            console.warn('[IA] Claude falhou na analise, usando fallback:', e.message);
        }
    }
    // Tentar OpenAI
    if (config_1.config.openaiApiKey) {
        try {
            const client = new openai_1.default({ apiKey: config_1.config.openaiApiKey });
            const resp = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                max_tokens: 600,
                messages: [{ role: 'user', content: analysisPrompt }],
            });
            const raw = (resp.choices[0]?.message?.content ?? '').trim();
            const parsed = JSON.parse(raw);
            console.log('[IA] Analise OpenAI concluida');
            return parsed;
        }
        catch (e) {
            console.warn('[IA] OpenAI falhou na analise, usando fallback:', e.message);
        }
    }
    // Fallback por palavras-chave
    const allText = messages.map(m => m.content).join(' ').toLowerCase();
    const { temperature } = await classifyIntentAndTemperature(allText);
    const lastClientMsg = [...messages].reverse().find(m => m.direction === 'INBOUND');
    const tipoMap = {
        preco: 'orcamento', valor: 'orcamento', financiamento: 'orcamento',
        comprar: 'venda', fechar: 'venda', pedido: 'venda',
        problema: 'suporte', erro: 'suporte', reclamacao: 'reclamacao',
    };
    let tipo = 'informacao';
    for (const [kw, t] of Object.entries(tipoMap)) {
        if (allText.includes(kw)) {
            tipo = t;
            break;
        }
    }
    return {
        tipo,
        temperatura: temperature,
        resumo: lastClientMsg ? `Cliente enviou: "${lastClientMsg.content.substring(0, 80)}"` : 'Sem mensagens do cliente',
        proximaAcao: temperature === 'URGENTE' ? 'Atender imediatamente — lead urgente'
            : temperature === 'QUENTE' ? 'Entrar em contato rapidamente — interesse alto'
                : 'Responder ao cliente e qualificar necessidade',
        respostaSugerida: 'Olá! Obrigado por entrar em contato. Como posso te ajudar hoje?',
        // Campos de qualificação — null no fallback (sem IA disponível)
        nomeCliente: null,
        cidade: null,
        bairro: null,
        regiao: null,
        ddd: null,
        modeloInteresse: null,
        urgencia: null,
        formaPagamento: null,
    };
}
async function classifyIntentAndTemperature(text) {
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
    let temperature = 'FRIO';
    let score = 10;
    if (keywords.URGENTE.some(k => lowerText.includes(k))) {
        temperature = 'URGENTE';
        score = 90;
    }
    else if (keywords.QUENTE.some(k => lowerText.includes(k))) {
        temperature = 'QUENTE';
        score = 70;
    }
    else if (keywords.MORNO.some(k => lowerText.includes(k))) {
        temperature = 'MORNO';
        score = 40;
    }
    const intent = lowerText.includes('preço') || lowerText.includes('valor') ? 'consulta_preco' :
        lowerText.includes('comprar') || lowerText.includes('fechar') ? 'intencao_compra' :
            lowerText.includes('dúvida') || lowerText.includes('informação') ? 'informacao' :
                'contato_inicial';
    return { intent, temperature, score };
}
//# sourceMappingURL=aiService.js.map