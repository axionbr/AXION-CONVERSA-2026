import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Send, Bot, Pause, UserCheck, MessageSquare, Clock, X,
  RefreshCw, Sparkles, ChevronRight, Flame, Loader2, Copy, CheckCheck,
  Play, Bell, MapPin, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  getConversations, getConversationMessages, sendMessage,
  assumeConversation, pauseAI, resumeAI,
  closeConversation, waitConversation, markConversationRead,
  getConversationAnalysis, requestConversationAnalysis,
  getPendingHandoffs, acceptHandoff,
} from '../lib/api';
import { getSocket, joinConversation, leaveConversation } from '../lib/socket';
import {
  cn, timeAgo, temperatureColor, modeLabel, modeColor,
  statusColor, statusLabel,
} from '../lib/utils';
import { useAuthStore } from '../store/authStore';

// ─── Constantes ───────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: '',                   label: 'Todos' },
  { value: 'NOVO',               label: 'Novos' },
  { value: 'EM_ATENDIMENTO',     label: 'Em Atendimento' },
  { value: 'AGUARDANDO_CLIENTE', label: 'Aguardando' },
  { value: 'FECHADO',            label: 'Fechados' },
];

const TEMP_COLORS: Record<string, string> = {
  FRIO:    'bg-blue-500/15 text-blue-400 border-blue-500/30',
  MORNO:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  QUENTE:  'bg-orange-500/15 text-orange-400 border-orange-500/30',
  URGENTE: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const TIPO_LABEL: Record<string, string> = {
  venda: 'Venda', suporte: 'Suporte', orcamento: 'Orçamento',
  reclamacao: 'Reclamação', informacao: 'Informação', outro: 'Outro',
};

// ─── Helpers de mensagem ──────────────────────────────────────────────────────

function resolveSenderType(msg: any): 'CLIENT' | 'AGENT' | 'AI' | 'FLOW' | 'SYSTEM' {
  if (msg.senderType === 'SYSTEM') return 'SYSTEM';
  if (msg.senderType === 'AI')     return 'AI';
  if (msg.senderType === 'FLOW')   return 'FLOW';
  if (msg.senderType === 'AGENT')  return 'AGENT';
  if (msg.direction === 'INBOUND') return 'CLIENT';
  return 'AGENT';
}

// ─── Banner de notificação de handoff ────────────────────────────────────────

function HandoffBanner({
  notif,
  onAccept,
  onDismiss,
  loading,
}: {
  notif: any;
  onAccept: () => void;
  onDismiss: () => void;
  loading: boolean;
}) {
  const [remaining, setRemaining] = useState<number>(() => {
    const diff = new Date(notif.expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 1000));
  });

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const urgent = remaining < 60;

  return (
    <motion.div
      initial={{ opacity: 0, y: -40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={cn(
        'mx-3 mt-2 rounded-xl border p-3 shadow-lg',
        urgent
          ? 'bg-red-500/10 border-red-500/40'
          : 'bg-orange-500/10 border-orange-500/40'
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
            urgent ? 'bg-red-500/20' : 'bg-orange-500/20'
          )}>
            <Flame className={cn('w-4 h-4', urgent ? 'text-red-400' : 'text-orange-400')} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#f5f5f5] truncate">
              {notif.contact?.name ?? 'Lead'} — Lead {notif.leadTemperature}
            </p>
            {notif.region && (
              <p className="text-[10px] text-[#b3b3b3] flex items-center gap-1">
                <MapPin className="w-2.5 h-2.5" />
                {notif.region}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn(
            'text-xs font-mono font-bold px-2 py-0.5 rounded-full',
            urgent ? 'text-red-400 bg-red-500/15' : 'text-orange-400 bg-orange-500/15'
          )}>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
          <button onClick={onDismiss} className="text-[#b3b3b3] hover:text-[#f5f5f5] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {notif.summary && (
        <p className="text-xs text-[#b3b3b3] mb-2 line-clamp-2 leading-relaxed">
          {notif.summary}
        </p>
      )}

      <button
        onClick={onAccept}
        disabled={loading || remaining === 0}
        className="w-full flex items-center justify-center gap-2 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition-colors"
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <CheckCircle2 className="w-4 h-4" />
        }
        {remaining === 0 ? 'Expirado' : 'Aceitar atendimento'}
      </button>
    </motion.div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Inbox() {
  const me = useAuthStore(s => s.user);

  const [statusFilter, setStatusFilter]   = useState('');
  const [search, setSearch]               = useState('');
  const [selectedId, setSelectedId]       = useState<string>('');
  const [msgInput, setMsgInput]           = useState('');
  const [localMessages, setLocalMessages] = useState<any[]>([]);
  const [showAnalysis, setShowAnalysis]   = useState(true);
  const [copied, setCopied]               = useState(false);
  const [handoffNotifs, setHandoffNotifs] = useState<any[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const qc        = useQueryClient();

  // ── Conversas ───────────────────────────────────────────────────────────────
  const { data, isError, refetch, isFetching } = useQuery({
    queryKey:        ['conversations-inbox', statusFilter, search],
    queryFn:         () => getConversations({ status: statusFilter || undefined, search: search || undefined, limit: 60 }),
    refetchInterval: 10_000,
    retry:           2,
  });

  const conversations = data?.conversations ?? [];

  // Destacar AGUARDANDO_HUMANO no topo da lista
  const sortedConversations = [...conversations].sort((a: any, b: any) => {
    const aHot = a.mode === 'AGUARDANDO_HUMANO' ? -1 : 0;
    const bHot = b.mode === 'AGUARDANDO_HUMANO' ? -1 : 0;
    return aHot - bHot;
  });

  const selected = conversations.find((c: any) => c.id === selectedId);

  // ── Mensagens da conversa aberta ─────────────────────────────────────────────
  const { data: messages = [] } = useQuery({
    queryKey: ['messages', selectedId],
    queryFn:  () => getConversationMessages(selectedId),
    enabled:  !!selectedId,
  });

  // ── Análise IA ───────────────────────────────────────────────────────────────
  const { data: analysisData, refetch: refetchAnalysis } = useQuery({
    queryKey:  ['analysis', selectedId],
    queryFn:   () => getConversationAnalysis(selectedId),
    enabled:   !!selectedId,
    staleTime: 60_000,
  });
  const analysis = analysisData?.analysis ?? null;

  const analyzeMut = useMutation({
    mutationFn: () => requestConversationAnalysis(selectedId),
    onSuccess:  () => refetchAnalysis(),
  });

  // ── Notificações pendentes no servidor (fallback se socket falhar) ────────────
  useQuery({
    queryKey: ['handoff-pending'],
    queryFn:  getPendingHandoffs,
    enabled:  !!me?.id,
    onSuccess: (data: any[]) => {
      setHandoffNotifs(prev => {
        const existingIds = new Set(prev.map((n: any) => n.notificationId));
        const newOnes = data
          .filter((n: any) => !existingIds.has(n.id))
          .map((n: any) => ({
            notificationId:  n.id,
            conversationId:  n.conversationId,
            leadId:          n.leadId,
            region:          n.region,
            summary:         n.summary,
            contact:         n.conversation?.contact,
            leadTemperature: n.conversation?.lead?.temperature ?? 'QUENTE',
            expiresAt:       n.expiresAt,
          }));
        return [...prev, ...newOnes];
      });
    },
  } as any);

  useEffect(() => { setLocalMessages(messages); }, [messages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [localMessages]);

  // ── Socket global ────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    const inv    = () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] });

    socket.on('message:new',          inv);
    socket.on('conversation:new',     inv);
    socket.on('conversation:updated', inv);

    // Notificação de handoff chegando para este vendedor
    socket.on('handoff:notification', (data: any) => {
      setHandoffNotifs(prev => {
        const exists = prev.some((n: any) => n.notificationId === data.notificationId);
        return exists ? prev : [...prev, data];
      });
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    });

    return () => {
      socket.off('message:new',          inv);
      socket.off('conversation:new',     inv);
      socket.off('conversation:updated', inv);
      socket.off('handoff:notification');
    };
  }, [qc]);

  // ── Socket da conversa aberta ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const socket = getSocket();
    joinConversation(selectedId);

    function onMsg(data: any) {
      if (data.conversationId !== selectedId) return;
      setLocalMessages(prev => {
        const exists = prev.some((m: any) => m.id === data.message.id);
        return exists ? prev : [...prev, data.message];
      });
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    }
    function onUpdate(data: any) {
      if (data.conversationId !== selectedId) return;
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    }

    socket.on('message:new',          onMsg);
    socket.on('conversation:updated', onUpdate);

    return () => {
      leaveConversation(selectedId);
      socket.off('message:new',          onMsg);
      socket.off('conversation:updated', onUpdate);
    };
  }, [selectedId, qc]);

  function openConversation(id: string) {
    setSelectedId(id);
    markConversationRead(id).catch(() => {});
    qc.setQueryData(['conversations-inbox', statusFilter, search], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        conversations: old.conversations.map((c: any) =>
          c.id === id ? { ...c, unreadCount: 0 } : c
        ),
      };
    });
  }

  function useAnalysisSuggestion() {
    if (analysis?.respostaSugerida) setMsgInput(analysis.respostaSugerida);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage(selectedId, content),
    onSuccess:  (msg) => {
      setMsgInput('');
      setLocalMessages(prev => {
        const exists = prev.some((m: any) => m.id === msg.id);
        return exists ? prev : [...prev, msg];
      });
    },
  });

  const assumeMut = useMutation({
    mutationFn: () => assumeConversation(selectedId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const pauseMut = useMutation({
    mutationFn: () => pauseAI(selectedId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const resumeMut = useMutation({
    mutationFn: () => resumeAI(selectedId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const waitMut = useMutation({
    mutationFn: () => waitConversation(selectedId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const closeMut = useMutation({
    mutationFn: () => closeConversation(selectedId),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
      setSelectedId('');
    },
  });

  const acceptMut = useMutation({
    mutationFn: (notifId: string) => acceptHandoff(notifId),
    onSuccess: (_, notifId) => {
      setHandoffNotifs(prev => prev.filter(n => n.notificationId !== notifId));
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    },
  });

  const totalUnread     = conversations.reduce((acc: number, c: any) => acc + (c.unreadCount || 0), 0);
  const notifCount      = handoffNotifs.length;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* Status tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b border-border bg-card/20 shrink-0">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setSelectedId(''); }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors border-b-2',
              statusFilter === tab.value
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
          >
            {tab.label}
            {tab.value === '' && totalUnread > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-primary text-white text-[10px] rounded-full">
                {totalUnread}
              </span>
            )}
          </button>
        ))}

        {/* Badge de notificações de handoff */}
        {notifCount > 0 && (
          <div className="ml-auto mr-1 flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-500/15 border border-orange-500/30">
            <Bell className="w-3 h-3 text-orange-400" />
            <span className="text-[10px] text-orange-400 font-bold">{notifCount}</span>
          </div>
        )}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-1 mr-1 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* Lista de conversas */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border bg-card/30">

          {/* Banners de notificação de handoff */}
          <AnimatePresence>
            {handoffNotifs.map(notif => (
              <HandoffBanner
                key={notif.notificationId}
                notif={notif}
                loading={acceptMut.isPending}
                onAccept={() => {
                  acceptMut.mutate(notif.notificationId);
                  // Abrir a conversa automaticamente
                  openConversation(notif.conversationId);
                }}
                onDismiss={() => setHandoffNotifs(prev =>
                  prev.filter(n => n.notificationId !== notif.notificationId)
                )}
              />
            ))}
          </AnimatePresence>

          {/* Busca */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar nome ou telefone..."
                className="w-full bg-input text-sm pl-9 pr-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {isError ? (
              <div className="text-center text-destructive text-sm py-8 px-3">
                <p>Erro ao carregar conversas.</p>
                <button onClick={() => refetch()} className="mt-2 underline text-xs">Tentar novamente</button>
              </div>
            ) : sortedConversations.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">
                {isFetching ? 'Carregando...' : 'Nenhuma conversa'}
              </p>
            ) : (
              sortedConversations.map((conv: any) => {
                const lastMsg    = conv.messages?.[0];
                const unread     = conv.unreadCount || 0;
                const isOutbound = lastMsg?.direction === 'OUTBOUND';
                const lastSender = lastMsg?.senderType === 'AI'     ? 'IA: '
                                 : lastMsg?.senderType === 'SYSTEM' ? ''
                                 : isOutbound                       ? '↩ ' : '';
                const isAwaitingHuman = conv.mode === 'AGUARDANDO_HUMANO';

                return (
                  <button
                    key={conv.id}
                    onClick={() => openConversation(conv.id)}
                    className={cn(
                      'w-full text-left p-3 border-b border-border/50 hover:bg-accent transition-colors',
                      selectedId === conv.id && 'bg-primary/10 border-l-2 border-l-primary',
                      isAwaitingHuman && selectedId !== conv.id && 'border-l-2 border-l-orange-400 bg-orange-500/5'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="relative shrink-0">
                        <div className={cn(
                          'w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold',
                          isAwaitingHuman ? 'bg-orange-500' : 'gradient-orange'
                        )}>
                          {isAwaitingHuman
                            ? <AlertTriangle className="w-4 h-4" />
                            : (conv.contact?.name?.charAt(0)?.toUpperCase() ?? '?')
                          }
                        </div>
                        {unread > 0 && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                            {unread > 9 ? '9+' : unread}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className={cn('text-sm truncate', unread > 0 ? 'font-semibold' : 'font-medium')}>
                            {conv.contact?.name ?? conv.contact?.phone ?? '—'}
                          </p>
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', statusColor[conv.status] ?? '')}>
                            {statusLabel[conv.status] ?? conv.status}
                          </span>
                        </div>
                        <p className={cn('text-xs truncate mt-0.5', unread > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                          <span className="text-muted-foreground">{lastSender}</span>
                          {lastMsg?.content ?? '...'}
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          {/* Badge de modo — destaque para AGUARDANDO_HUMANO */}
                          <span className={cn(
                            'text-[10px] px-1 rounded border',
                            modeColor[conv.mode] ?? 'text-gray-400 bg-gray-400/10 border-gray-400/30'
                          )}>
                            {modeLabel[conv.mode] ?? conv.mode}
                          </span>
                          {conv.lead?.temperature && (
                            <span className={cn('text-[10px] px-1 rounded border', temperatureColor[conv.lead.temperature])}>
                              {conv.lead.temperature}
                            </span>
                          )}
                          {conv.assignedUser && (
                            <span className="text-[10px] text-muted-foreground truncate">
                              {conv.assignedUser.name}
                            </span>
                          )}
                          {conv.lastMessageAt && (
                            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                              {timeAgo(conv.lastMessageAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Área de chat */}
        {selectedId && selected ? (
          <>
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full gradient-orange flex items-center justify-center text-white font-bold shrink-0">
                    {selected.contact?.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold truncate">{selected.contact?.name}</p>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', statusColor[selected.status] ?? '')}>
                        {statusLabel[selected.status] ?? selected.status}
                      </span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', modeColor[selected.mode] ?? '')}>
                        {modeLabel[selected.mode] ?? selected.mode}
                      </span>
                      {selected.lead?.temperature && (
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', TEMP_COLORS[selected.lead.temperature] ?? '')}>
                          <Flame className="w-2.5 h-2.5 inline mr-0.5" />
                          {selected.lead.temperature}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{selected.contact?.phone}</span>
                      {selected.assignedUser && (
                        <span>• <span className="text-green-400 font-medium">{selected.assignedUser.name} (responsável)</span></span>
                      )}
                      {selected.lead?.region && (
                        <span className="flex items-center gap-1">
                          • <MapPin className="w-3 h-3" /> {selected.lead.region}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  {selected.status !== 'FECHADO' && (
                    <>
                      {/* Aceitar Atendimento — para conversas em AGUARDANDO_HUMANO */}
                      {selected.mode === 'AGUARDANDO_HUMANO' && (
                        <button
                          onClick={() => {
                            const notif = handoffNotifs.find(n => n.conversationId === selectedId);
                            if (notif) {
                              acceptMut.mutate(notif.notificationId);
                            } else {
                              assumeMut.mutate();
                            }
                          }}
                          disabled={acceptMut.isPending || assumeMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 text-xs hover:bg-orange-500/30 disabled:opacity-50 transition-colors border border-orange-500/30 font-semibold animate-pulse"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Aceitar
                        </button>
                      )}

                      {/* Assumir manualmente (sem notificação formal) */}
                      {selected.mode !== 'AGUARDANDO_HUMANO' && (
                        <button
                          onClick={() => assumeMut.mutate()}
                          disabled={assumeMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs hover:bg-blue-500/25 disabled:opacity-50 transition-colors"
                        >
                          <UserCheck className="w-3.5 h-3.5" /> Assumir
                        </button>
                      )}

                      {/* IA */}
                      {selected.aiEnabled ? (
                        <button onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 text-xs hover:bg-orange-500/25 disabled:opacity-50 transition-colors">
                          <Pause className="w-3.5 h-3.5" /> Pausar IA
                        </button>
                      ) : (
                        <button onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs hover:bg-green-500/25 disabled:opacity-50 transition-colors">
                          <Play className="w-3.5 h-3.5" /> Ativar IA
                        </button>
                      )}

                      {selected.status !== 'AGUARDANDO_CLIENTE' && (
                        <button onClick={() => waitMut.mutate()} disabled={waitMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 text-xs hover:bg-yellow-500/25 disabled:opacity-50 transition-colors">
                          <Clock className="w-3.5 h-3.5" /> Aguardar
                        </button>
                      )}
                      <button onClick={() => { if (confirm('Fechar esta conversa?')) closeMut.mutate(); }} disabled={closeMut.isPending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs hover:bg-red-500/25 disabled:opacity-50 transition-colors">
                        <X className="w-3.5 h-3.5" /> Fechar
                      </button>
                    </>
                  )}
                  {selected.status === 'FECHADO' && (
                    <span className="text-xs text-muted-foreground px-2">Conversa encerrada</span>
                  )}
                  <button
                    onClick={() => setShowAnalysis(v => !v)}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                      showAnalysis ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                    title="Painel de análise IA"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                <AnimatePresence initial={false}>
                  {localMessages.map((msg: any) => {
                    const senderType = resolveSenderType(msg);
                    const isOutbound = msg.direction === 'OUTBOUND';

                    // ── Mensagem de sistema (centralizada) ──────────────────────
                    if (senderType === 'SYSTEM') {
                      return (
                        <motion.div key={msg.id}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          className="flex justify-center py-1"
                        >
                          <span className="text-[11px] text-muted-foreground bg-muted/50 px-3 py-1 rounded-full border border-border/50 flex items-center gap-1">
                            <UserCheck className="w-3 h-3" />
                            {msg.content}
                          </span>
                        </motion.div>
                      );
                    }

                    const senderLabel = isOutbound
                      ? senderType === 'AI'   ? 'IA Auto'
                      : senderType === 'FLOW' ? 'Fluxo'
                      : (msg.senderUser?.name ?? selected.assignedUser?.name ?? 'Atendente')
                      : (selected.contact?.name ?? '');

                    const bubbleCls = !isOutbound
                      ? 'bg-card text-foreground rounded-bl-sm border border-border'
                      : senderType === 'AI'
                      ? 'bg-blue-600/80 text-white rounded-br-sm'
                      : senderType === 'FLOW'
                      ? 'bg-purple-600/70 text-white rounded-br-sm'
                      : 'bg-primary text-white rounded-br-sm';

                    return (
                      <motion.div key={msg.id}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                        className={cn('flex flex-col gap-0.5', isOutbound ? 'items-end' : 'items-start')}
                      >
                        <span className="text-[10px] text-muted-foreground px-1 flex items-center gap-1">
                          {senderType === 'AI'    && <Bot className="w-3 h-3 text-blue-400" />}
                          {senderType === 'AGENT' && <UserCheck className="w-3 h-3 text-green-400" />}
                          {senderLabel}
                        </span>
                        <div className={cn('max-w-[70%] px-4 py-2.5 rounded-2xl text-sm', bubbleCls)}>
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          <p className={cn('text-[11px] mt-1', isOutbound ? 'text-white/60' : 'text-muted-foreground')}>
                            {timeAgo(msg.createdAt)}
                            {msg.fromFlow && ' • Fluxo'}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                <div ref={bottomRef} />
              </div>

              {/* Input de envio */}
              <div className="p-4 border-t border-border bg-card/30 shrink-0">
                {/* Banner de vendedor responsável */}
                {selected.assignedUser && selected.status !== 'FECHADO' && (
                  <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-green-500/8 border border-green-500/20">
                    <UserCheck className="w-3.5 h-3.5 text-green-400 shrink-0" />
                    <span className="text-xs text-green-400">
                      <strong>{selected.assignedUser.name}</strong> está atendendo — mensagens saem pelo número central
                    </span>
                  </div>
                )}

                {selected.status === 'FECHADO' ? (
                  <p className="text-center text-sm text-muted-foreground py-1">
                    Conversa fechada — não é possível enviar mensagens
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={msgInput}
                      onChange={e => setMsgInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && msgInput.trim()) {
                          e.preventDefault();
                          sendMut.mutate(msgInput.trim());
                        }
                      }}
                      placeholder="Digite uma mensagem... (Enter para enviar pelo número central)"
                      className="flex-1 bg-input text-sm px-4 py-2.5 rounded-xl border border-border focus:border-primary outline-none transition-colors"
                    />
                    <button
                      onClick={() => msgInput.trim() && sendMut.mutate(msgInput.trim())}
                      disabled={!msgInput.trim() || sendMut.isPending}
                      className="px-4 py-2.5 bg-primary text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {sendMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Painel de análise IA */}
            <AnimatePresence>
              {showAnalysis && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 280, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0 border-l border-border bg-[#1e1e1e] flex flex-col overflow-hidden"
                  style={{ width: 280 }}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">Análise IA</span>
                    </div>
                    <button
                      onClick={() => analyzeMut.mutate()}
                      disabled={analyzeMut.isPending}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/15 text-primary text-xs hover:bg-primary/25 disabled:opacity-50 transition-colors"
                    >
                      {analyzeMut.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Sparkles className="w-3 h-3" />
                      }
                      {analyzeMut.isPending ? 'Analisando...' : 'Analisar'}
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {!analysis ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <Sparkles className="w-8 h-8 text-muted-foreground/30 mb-3" />
                        <p className="text-sm text-muted-foreground">Sem análise ainda</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          Clique em "Analisar" para obter insights
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs px-2 py-1 rounded-full bg-[#2a2a2a] border border-border text-foreground">
                            {TIPO_LABEL[analysis.tipo] ?? analysis.tipo}
                          </span>
                          <span className={cn('text-xs px-2 py-1 rounded-full border', TEMP_COLORS[analysis.temperatura] ?? '')}>
                            <Flame className="w-2.5 h-2.5 inline mr-0.5" />
                            {analysis.temperatura}
                          </span>
                        </div>

                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-medium">Resumo</p>
                          <p className="text-xs text-foreground/90 leading-relaxed">{analysis.resumo}</p>
                        </div>

                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <p className="text-[10px] text-primary uppercase tracking-wider mb-1 font-medium flex items-center gap-1">
                            <ChevronRight className="w-3 h-3" /> Próxima ação
                          </p>
                          <p className="text-xs text-foreground/90">{analysis.proximaAcao}</p>
                        </div>

                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-blue-400 uppercase tracking-wider font-medium flex items-center gap-1">
                              <Bot className="w-3 h-3" /> Resposta sugerida
                            </p>
                            <button
                              onClick={() => copyText(analysis.respostaSugerida)}
                              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {copied ? <CheckCheck className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                          <p className="text-xs text-foreground/90 leading-relaxed mb-3">
                            {analysis.respostaSugerida}
                          </p>
                          {selected.status !== 'FECHADO' && (
                            <button
                              onClick={useAnalysisSuggestion}
                              className="w-full py-1.5 rounded-lg bg-blue-600/20 text-blue-400 text-xs font-medium hover:bg-blue-600/30 transition-colors border border-blue-500/20"
                            >
                              Usar esta resposta
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3 mx-auto" />
              <p className="text-muted-foreground">Selecione uma conversa</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {conversations.length} conversa{conversations.length !== 1 ? 's' : ''} na lista
              </p>
              {notifCount > 0 && (
                <div className="mt-4 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                  <Bell className="w-4 h-4 text-orange-400" />
                  <span className="text-xs text-orange-400 font-medium">
                    {notifCount} lead{notifCount > 1 ? 's quentes' : ' quente'} aguardando você
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
