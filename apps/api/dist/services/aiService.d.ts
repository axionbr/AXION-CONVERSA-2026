export declare function generateAiResponse(conversationId: string, messages: {
    role: 'user' | 'assistant';
    content: string;
}[], storeId?: string | null): Promise<string>;
export interface ConversationAnalysis {
    tipo: 'venda' | 'suporte' | 'orcamento' | 'reclamacao' | 'informacao' | 'outro';
    temperatura: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
    resumo: string;
    proximaAcao: string;
    respostaSugerida: string;
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