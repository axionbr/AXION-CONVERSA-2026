import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Users, Clock, CheckCircle, TrendingUp, Flame, Bot, Filter, Maximize2,
} from 'lucide-react';
import { getDashboardMetrics, getLiveConversations } from '../lib/api';
import { getSocket } from '../lib/socket';
import ConversationCard from '../components/ConversationCard';
import ConversationDrawer from '../components/ConversationDrawer';
import { cn } from '../lib/utils';

interface Metric {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
}

export default function Dashboard() {
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newMessages, setNewMessages] = useState<Record<string, { content: string; id: string }>>({});
  const [filters, setFilters] = useState({ temperature: '', status: '' });
  const qc = useQueryClient();

  const { data: metrics } = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: getDashboardMetrics,
    refetchInterval: 30_000,
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ['live-conversations', filters],
    queryFn: () => getLiveConversations(filters),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const socket = getSocket();

    socket.on('message:new', (data: any) => {
      setNewMessages(prev => ({ ...prev, [data.conversationId]: data.message }));
      setTimeout(() => {
        setNewMessages(prev => {
          const n = { ...prev };
          delete n[data.conversationId];
          return n;
        });
      }, 5000);
      qc.invalidateQueries({ queryKey: ['live-conversations'] });
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    });

    socket.on('conversation:new', () => {
      qc.invalidateQueries({ queryKey: ['live-conversations'] });
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    });

    return () => {
      socket.off('message:new');
      socket.off('conversation:new');
    };
  }, [qc]);

  const metricCards: Metric[] = [
    { label: 'Conversas Ativas', value: metrics?.activeConversations ?? '—', icon: MessageSquare, color: 'text-blue-400' },
    { label: 'Aguardando Humano', value: metrics?.awaitingHuman ?? '—', icon: Clock, color: 'text-yellow-400' },
    { label: 'Resolvidas Hoje', value: metrics?.resolvedToday ?? '—', icon: CheckCircle, color: 'text-green-400' },
    { label: 'Leads Hoje', value: metrics?.newLeadsToday ?? '—', icon: TrendingUp, color: 'text-primary' },
    { label: 'Leads Quentes', value: metrics?.hotLeads ?? '—', icon: Flame, color: 'text-orange-400' },
    { label: 'Atendidas por IA', value: metrics?.aiHandled ?? '—', icon: Bot, color: 'text-purple-400' },
  ];

  const temps = ['', 'FRIO', 'MORNO', 'QUENTE', 'URGENTE'];
  const statuses = ['', 'ABERTA', 'EM_ATENDIMENTO', 'AGUARDANDO'];

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur">
        <div>
          <h1 className="text-lg font-bold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">Painel vivo de conversas em tempo real</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-muted-foreground">Ao vivo</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {metricCards.map((m) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-xl p-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <m.icon className={cn('w-4 h-4', m.color)} />
                <span className="text-xs text-muted-foreground">{m.label}</span>
              </div>
              <p className={cn('text-2xl font-bold', m.color)}>{m.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={filters.temperature}
            onChange={e => setFilters(f => ({ ...f, temperature: e.target.value }))}
            className="text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary"
          >
            <option value="">Temperatura</option>
            {temps.slice(1).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
            className="text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary"
          >
            <option value="">Status</option>
            {statuses.slice(1).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(filters.temperature || filters.status) && (
            <button
              onClick={() => setFilters({ temperature: '', status: '' })}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Limpar filtros
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {conversations.length} conversa{conversations.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Conversations Grid */}
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma conversa ativa</p>
            <p className="text-sm text-muted-foreground/60">As conversas aparecerão aqui em tempo real</p>
          </div>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            <AnimatePresence>
              {conversations.map((conv: any) => (
                <ConversationCard
                  key={conv.id}
                  conversation={conv}
                  newMessage={newMessages[conv.id] || null}
                  onClick={() => { setSelectedConv(conv); setDrawerOpen(true); }}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Drawer */}
      {selectedConv && (
        <ConversationDrawer
          conversation={selectedConv}
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
