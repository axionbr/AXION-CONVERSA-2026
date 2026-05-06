"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
exports.getIO = getIO;
exports.emitNewMessage = emitNewMessage;
exports.emitConversationUpdate = emitConversationUpdate;
exports.emitNewConversation = emitNewConversation;
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
        console.log(`Socket connected: ${socket.id}`);
        socket.on('join:conversation', (conversationId) => {
            socket.join(`conv:${conversationId}`);
        });
        socket.on('leave:conversation', (conversationId) => {
            socket.leave(`conv:${conversationId}`);
        });
        socket.on('join:dashboard', () => {
            socket.join('dashboard');
        });
        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`);
        });
    });
    return io;
}
function getIO() {
    if (!io)
        throw new Error('Socket.IO not initialized');
    return io;
}
function emitNewMessage(conversationId, message) {
    getIO().to(`conv:${conversationId}`).emit('message:new', { conversationId, message });
    getIO().to('dashboard').emit('message:new', { conversationId, message });
}
function emitConversationUpdate(conversationId, data) {
    getIO().to('dashboard').emit('conversation:updated', { conversationId, ...data });
}
function emitNewConversation(data) {
    getIO().to('dashboard').emit('conversation:new', data);
}
//# sourceMappingURL=index.js.map