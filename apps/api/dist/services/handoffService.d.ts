export declare const HANDOFF_MSG: string;
export declare function extractRegion(text: string): string | null;
export declare function findBestSeller(storeId: string | null, region: string | null, excludeIds?: string[]): Promise<{
    id: string;
    name: string;
} | null>;
export declare function initiateHandoff(conversationId: string, lead: {
    id: string;
    phone: string;
    temperature: string;
    storeId?: string | null;
    region?: string | null;
}, aiSummary?: string): Promise<void>;
export declare function acceptHandoff(notificationId: string, userId: string): Promise<{
    ok: boolean;
    error?: string;
}>;
export declare function checkExpiry(notificationId: string): Promise<void>;
export declare function checkExpiredNotifications(): Promise<void>;
//# sourceMappingURL=handoffService.d.ts.map