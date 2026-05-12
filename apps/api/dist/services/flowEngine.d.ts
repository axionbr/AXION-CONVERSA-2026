export declare const CONVERSATIONAL_EVENTS: Set<string>;
/**
 * Dispara fluxos cadastrados para o evento dado.
 * Retorna `true` se ao menos um fluxo foi efetivamente executado.
 * Usado pelo webhookProcessor para decidir se a IA deve fazer fallback.
 */
export declare function triggerFlowsByEvent(eventType: string, value: string, conversationId: string, leadId: string): Promise<boolean>;
export declare function executeFlow(flowId: string, conversationId: string, leadId?: string): Promise<void>;
//# sourceMappingURL=flowEngine.d.ts.map