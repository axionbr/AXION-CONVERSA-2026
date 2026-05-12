export interface LeadContext {
    name?: string | null;
    region?: string | null;
    interest?: string | null;
    temperature?: string | null;
    formaPagamento?: string | null;
}
export declare function generateAiResponse(conversationId: string, messages: {
    role: 'user' | 'assistant';
    content: string;
}[], storeId?: string | null, leadContext?: LeadContext): Promise<string>;
export interface ConversationAnalysis {
    tipo: 'venda' | 'suporte' | 'orcamento' | 'reclamacao' | 'informacao' | 'outro';
    temperatura: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
    resumo: string;
    proximaAcao: string;
    respostaSugerida: string;
    nomeCliente?: string | null;
    cidade?: string | null;
    bairro?: string | null;
    regiao?: string | null;
    ddd?: string | null;
    modeloInteresse?: string | null;
    urgencia?: 'imediata' | 'proximas_semanas' | 'pesquisando' | null;
    formaPagamento?: 'avista' | 'cartao' | 'financiamento' | 'consorcio' | null;
}
export declare function analyzeConversation(messages: Array<{
    direction: string;
    content: string;
    senderType: string;
}>, storeId?: string | null): Promise<ConversationAnalysis>;
export declare function classifyIntentAndTemperature(text: string): Promise<{
    intent: string;
    temperature: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
    score: number;
}>;
//# sourceMappingURL=aiService.d.ts.map