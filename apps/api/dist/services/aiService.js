"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiResponse = generateAiResponse;
exports.classifyIntentAndTemperature = classifyIntentAndTemperature;
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const config_1 = require("../config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_SYSTEM_PROMPT = 'Você é um assistente de atendimento comercial do WhatsApp. ' +
    'Responda de forma cordial, direta e objetiva. ' +
    'Seja breve (máximo 2-3 frases curtas). ' +
    'Foque em entender a necessidade do cliente e conduzir para o próximo passo da venda.';
/** Valida se um nome de modelo pertence ao Claude/Anthropic. */
function isClaudeModel(model) {
    return model.startsWith('claude-') || model.startsWith('claude3');
}
/** Valida se um nome de modelo pertence ao OpenAI. */
function isOpenAiModel(model) {
    return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
}
async function generateAiResponse(conversationId, messages, storeId) {
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
        return block.type === 'text' ? block.text.trim() : '';
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
        return (response.choices[0]?.message?.content ?? '').trim();
    }
}
async function classifyIntentAndTemperature(text) {
    const keywords = {
        URGENTE: ['urgente', 'agora', 'hoje', 'preciso muito', 'emergência', 'imediato'],
        QUENTE: ['comprar', 'fechar', 'quanto', 'preço', 'valor', 'parcela', 'financiamento', 'disponível'],
        MORNO: ['interesse', 'quero', 'gostaria', 'pensando', 'considerando', 'talvez'],
        FRIO: ['informação', 'dúvida', 'curiosidade', 'apenas perguntando'],
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