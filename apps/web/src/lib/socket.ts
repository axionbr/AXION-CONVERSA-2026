import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', { path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  s.connect();
  s.emit('join:dashboard');
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function joinConversation(id: string) {
  getSocket().emit('join:conversation', id);
}

export function leaveConversation(id: string) {
  getSocket().emit('leave:conversation', id);
}
