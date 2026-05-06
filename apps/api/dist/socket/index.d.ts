import { Server } from 'socket.io';
export declare function initSocket(server: any): Server<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>;
export declare function getIO(): Server;
export declare function emitNewMessage(conversationId: string, message: any): void;
export declare function emitConversationUpdate(conversationId: string, data: any): void;
export declare function emitNewConversation(data: any): void;
//# sourceMappingURL=index.d.ts.map