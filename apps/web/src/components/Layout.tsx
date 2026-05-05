import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import Sidebar from './Sidebar';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { useAuthStore } from '../store/authStore';

export default function Layout() {
  const token = useAuthStore(s => s.token);

  useEffect(() => {
    if (token) connectSocket();
    return () => disconnectSocket();
  }, [token]);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
