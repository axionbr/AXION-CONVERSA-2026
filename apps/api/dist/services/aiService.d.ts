export type AgentType = 'SDR' | 'QUALIFIER' | 'CONSULTANT';
/**
 * Determina qual agente deve atender com base no estado do lead e histórico.
 *
 * SDR        → primeiros 2 contatos: recepcionar, entender intenção básica
 * QUALIFIER  → 3+ mensagens, ainda falta cidade/região ou interesse
 * CONSULTANT → perfil completo (região + interesse), orientar e preparar handoff
 */
export declare function determineAgentStage(lead: {
    region?: string | null;
    interest?: string | null;
    temperature?: string;
}, inboundCount: number): AgentType;
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
}[], storeId?: string | null, leadContext?: LeadContext, agentType?: AgentType): Promise<string>;
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