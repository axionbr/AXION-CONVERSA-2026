import { Server } from 'socket.io';
import { config } from '../config';

let io: Server;

export function initSocket(server: any) {
  io = new Server(server, {
    cors: {
      origin: config.frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join:conversation', (conversationId: string) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on('leave:conversation', (conversationId: string) => {
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

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

export function emitNewMessage(conversationId: string, message: any) {
  getIO().to(`conv:${conversationId}`).emit('message:new', { conversationId, message });
  getIO().to('dashboard').emit('message:new', { conversationId, message });
}

export function emitConversationUpdate(conversationId: string, data: any) {
  const payload = { conversationId, ...data };
  getIO().to('dashboard').emit('conversation:updated', payload);
  getIO().to(`conv:${conversationId}`).emit('conversation:updated', payload);
}

export function emitNewConversation(data: any) {
  getIO().to('dashboard').emit('conversation:new', data);
}
