export declare function generateAiResponse(conversationId: string, messages: {
    role: 'user' | 'assistant';
    content: string;
}[], storeId?: string | null): Promise<string>;
export declare function classifyIntentAndTemperature(text: string): Promise<{
    intent: string;
    temperature: 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
    score: number;
}>;
//# sourceMappingURL=aiService.d.ts.map