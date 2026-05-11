"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
exports.getIO = getIO;
exports.emitNewMessage = emitNewMessage;
exports.emitConversationUpdate = emitConversationUpdate;
exports.emitNewConversation = emitNewConversation;
exports.emitToUser = emitToUser;
const socket_io_1 = require("socket.io");
const config_1 = require("../config");
let io;
function initSocket(server) {
    io = new socket_io_1.Server(server, {
        cors: {
            origin: config_1.config.frontendUrl,
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });
    io.on('connection', (socket) => {
        console.log(`[SOCKET] conectado: ${socket.id}`);
        // Room da conversa específica
        socket.on('join:conversation', (conversationId) => {
            socket.join(`conv:${conversationId}`);
        });
        socket.on('leave:conversation', (conversationId) => {
            socket.leave(`conv:${conversationId}`);
        });
        // Room global do dashboard
        socket.on('join:dashboard', () => {
            socket.join('dashboard');
        });
        // Room pessoal do usuário — notificações de handoff para vendedor específico
        socket.on('join:user', (userId) => {
            if (userId && typeof userId === 'string') {
                socket.join(`user:${userId}`);
            }
        });
        socket.on('disconnect', () => {
            console.log(`[SOCKET] desconectado: ${socket.id}`);
        });
    });
    return io;
}
function getIO() {
    if (!io)
        throw new Error('Socket.IO not initialized');
    return io;
}
// ─── Emissores ────────────────────────────────────────────────────────────────
function emitNewMessage(conversationId, message) {
    getIO().to(`conv:${conversationId}`).emit('message:new', { conversationId, message });
    getIO().to('dashboard').emit('message:new', { conversationId, message });
}
function emitConversationUpdate(conversationId, data) {
    const payload = { conversationId, ...data };
    getIO().to('dashboard').emit('conversation:updated', payload);
    getIO().to(`conv:${conversationId}`).emit('conversation:updated', payload);
}
function emitNewConversation(data) {
    getIO().to('dashboard').emit('conversation:new', data);
}
// Emite evento para um usuário específico (sala user:<userId>)
function emitToUser(userId, event, data) {
    getIO().to(`user:${userId}`).emit(event, data);
}
//# sourceMappingURL=index.js.map