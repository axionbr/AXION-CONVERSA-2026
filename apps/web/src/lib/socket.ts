import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let dashboardListenerSetup = false;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', { path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();

  // Registra listener de connect UMA vez (inclui reconexões automáticas)
  // O 'connect' é emitido tanto na conexão inicial quanto em cada reconexão
  if (!dashboardListenerSetup) {
    s.on('connect', () => {
      s.emit('join:dashboard');
    });
    dashboardListenerSetup = true;
  }

  if (s.connected) {
    // Já conectado (ex: troca de token) — re-join imediato
    s.emit('join:dashboard');
  } else {
    s.connect();
  }

  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  dashboardListenerSetup = false;
}

export function joinConversation(id: string) {
  getSocket().emit('join:conversation', id);
}

export function leaveConversation(id: string) {
  getSocket().emit('leave:conversation', id);
}

// Entrar na sala pessoal do usuário para receber notificações de handoff
export function joinUserRoom(userId: string) {
  if (userId) getSocket().emit('join:user', userId);
}
