export declare const CONVERSATIONAL_EVENTS: Set<string>;
export declare function triggerFlowsByEvent(eventType: string, value: string, conversationId: string, leadId: string): Promise<boolean>;
export declare function executeFlow(flowId: string, conversationId: string, leadId?: string, testMode?: boolean, forceRun?: boolean): Promise<string | null>;
export declare function continueExecutionWithResponse(executionId: string, userMessage: string): Promise<void>;
//# sourceMappingURL=flowEngine.d.ts.map