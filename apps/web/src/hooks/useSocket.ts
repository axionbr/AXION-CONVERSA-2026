import { useEffect, useCallback } from 'react';
import { getSocket } from '../lib/socket';

export function useSocketEvent<T>(event: string, handler: (data: T) => void) {
  const stable = useCallback(handler, []);

  useEffect(() => {
    const socket = getSocket();
    socket.on(event, stable);
    return () => { socket.off(event, stable); };
  }, [event, stable]);
}
