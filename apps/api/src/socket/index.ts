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
    console.log(`[SOCKET] conectado: ${socket.id}`);

    // Room da conversa específica
    socket.on('join:conversation', (conversationId: string) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on('leave:conversation', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Room global do dashboard
    socket.on('join:dashboard', () => {
      socket.join('dashboard');
    });

    // Room pessoal do usuário — notificações de handoff para vendedor específico
    socket.on('join:user', (userId: string) => {
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

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

// ─── Emissores ────────────────────────────────────────────────────────────────

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

// Emite evento para um usuário específico (sala user:<userId>)
export function emitToUser(userId: string, event: string, data: any) {
  getIO().to(`user:${userId}`).emit(event, data);
}
