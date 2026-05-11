export declare const config: {
    port: number;
    nodeEnv: string;
    jwtSecret: string;
    jwtExpiresIn: string;
    frontendUrl: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    aiProvider: "openai" | "anthropic";
    aiModel: string;
    zapi: {
        instanceId: string;
        token: string;
        clientToken: string;
        baseUrl: string;
    };
    webhookSecret: string;
};
export declare function validateProductionConfig(): void;
//# sourceMappingURL=config.d.ts.map