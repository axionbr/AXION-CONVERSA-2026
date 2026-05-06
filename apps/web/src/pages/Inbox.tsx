import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Send, Bot, Pause, UserCheck, MessageSquare,
  Clock, X, ChevronDown,
} from 'lucide-react';
import {
  getConversations, getConversationMessages, sendMessage,
  assumeConversation, pauseAI, resumeAI,
  closeConversation, waitConversation, markConversationRead,
} from '../lib/api';
import { getSocket, joinConversation, leaveConversation } from '../lib/socket';
import { cn, timeAgo, temperatureColor, modeLabel, statusColor, statusLabel } from '../lib/utils';

const STATUS_TABS = [
  { value: '', label: 'Todos' },
  { value: 'NOVO', label: 'Novos' },
  { value: 'EM_ATENDIMENTO', label: 'Em Atendimento' },
  { value: 'AGUARDANDO_CLIENTE', label: 'Aguardando' },
  { value: 'FECHADO', label: 'Fechados' },
];

export default function Inbox() {
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [msgInput, setMsgInput] = useState('');
  const [localMessages, setLocalMessages] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['conversations-inbox', statusFilter, search],
    queryFn: () => getConversations({ status: statusFilter || undefined, search: search || undefined, limit: 60 }),
    refetchInterval: 15_000,
  });
  const conversations = data?.conversations || [];
  const selected = conversations.find((c: any) => c.id === selectedId);

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', selectedId],
    queryFn: () => getConversationMessages(selectedId),
    enabled: !!selectedId,
  });

  useEffect(() => { setLocalMessages(messages); }, [messages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [localMessages]);

  // Abrir conversa: marcar como lido
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

  // Socket: mensagens em tempo real
  useEffect(() => {
    const socket = getSocket();
    if (selectedId) {
      joinConversation(selectedId);
      socket.on('message:new', (data: any) => {
        if (data.conversationId === selectedId) {
          setLocalMessages(prev => {
            const exists = prev.some((m: any) => m.id === data.message.id);
            return exists ? prev : [...prev, data.message];
          });
        }
        qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
      });
      socket.on('conversation:updated', () => {
        qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
      });
      socket.on('conversation:new', () => {
        qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
      });
    }
    return () => {
      if (selectedId) leaveConversation(selectedId);
      socket.off('message:new');
      socket.off('conversation:updated');
      socket.off('conversation:new');
    };
  }, [selectedId, qc]);

  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage(selectedId, content),
    onSuccess: (msg) => {
      setMsgInput('');
      setLocalMessages(prev => [...prev, msg]);
    },
  });

  const assumeMut = useMutation({
    mutationFn: () => assumeConversation(selectedId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const pauseMut = useMutation({
    mutationFn: () => pauseAI(selectedId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const resumeMut = useMutation({
    mutationFn: () => resumeAI(selectedId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const waitMut = useMutation({
    mutationFn: () => waitConversation(selectedId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }),
  });
  const closeMut = useMutation({
    mutationFn: () => closeConversation(selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
      setSelectedId('');
    },
  });

  const totalUnread = conversations.reduce((acc: number, c: any) => acc + (c.unreadCount || 0), 0);

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
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Lista de conversas */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border bg-card/30">
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

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">Nenhuma conversa</p>
            ) : (
              conversations.map((conv: any) => {
                const lastMsg = conv.messages?.[0];
                const unread = conv.unreadCount || 0;
                return (
                  <button
                    key={conv.id}
                    onClick={() => openConversation(conv.id)}
                    className={cn(
                      'w-full text-left p-3 border-b border-border/50 hover:bg-accent transition-colors',
                      selectedId === conv.id && 'bg-primary/10 border-l-2 border-l-primary'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <div className="w-9 h-9 rounded-full gradient-orange flex items-center justify-center text-white text-xs font-bold">
                          {conv.contact?.name?.charAt(0)?.toUpperCase()}
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
                            {conv.contact?.name}
                          </p>
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', statusColor[conv.status] || '')}>
                            {statusLabel[conv.status] || conv.status}
                          </span>
                        </div>

                        <p className={cn('text-xs truncate mt-0.5', unread > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                          {lastMsg?.direction === 'OUTBOUND' ? '↩ ' : ''}{lastMsg?.content || '...'}
                        </p>

                        <div className="flex items-center gap-1 mt-1">
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
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header do chat */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full gradient-orange flex items-center justify-center text-white font-bold shrink-0">
                  {selected.contact?.name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{selected.contact?.name}</p>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', statusColor[selected.status] || '')}>
                      {statusLabel[selected.status] || selected.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{selected.contact?.phone}</span>
                    {selected.assignedUser && <span>• {selected.assignedUser.name}</span>}
                    <span className="px-1 rounded bg-accent">
                      {modeLabel[selected.mode] || selected.mode}
                    </span>
                  </div>
                </div>
              </div>

              {/* Ações */}
              <div className="flex items-center gap-1.5 shrink-0">
                {selected.status !== 'FECHADO' && (
                  <>
                    <button
                      onClick={() => assumeMut.mutate()}
                      disabled={assumeMut.isPending}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs hover:bg-blue-500/25 disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Assumir
                    </button>

                    {selected.aiEnabled ? (
                      <button
                        onClick={() => pauseMut.mutate()}
                        disabled={pauseMut.isPending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 text-xs hover:bg-orange-500/25 disabled:opacity-50"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        Pausar IA
                      </button>
                    ) : (
                      <button
                        onClick={() => resumeMut.mutate()}
                        disabled={resumeMut.isPending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs hover:bg-green-500/25 disabled:opacity-50"
                      >
                        <Bot className="w-3.5 h-3.5" />
                        Ativar IA
                      </button>
                    )}

                    {selected.status !== 'AGUARDANDO_CLIENTE' && (
                      <button
                        onClick={() => waitMut.mutate()}
                        disabled={waitMut.isPending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 text-xs hover:bg-yellow-500/25 disabled:opacity-50"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Aguardar
                      </button>
                    )}

                    <button
                      onClick={() => { if (confirm('Fechar esta conversa?')) closeMut.mutate(); }}
                      disabled={closeMut.isPending}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-xs hover:bg-red-500/25 disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      Fechar
                    </button>
                  </>
                )}

                {selected.status === 'FECHADO' && (
                  <span className="text-xs text-muted-foreground px-2">Conversa encerrada</span>
                )}
              </div>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <AnimatePresence initial={false}>
                {localMessages.map((msg: any) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={cn('flex', msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[70%] px-4 py-2.5 rounded-2xl text-sm',
                        msg.direction === 'OUTBOUND'
                          ? 'bg-primary text-white rounded-br-sm'
                          : 'bg-card text-foreground rounded-bl-sm border border-border',
                        msg.fromFlow && 'ring-1 ring-blue-400/50'
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={cn('text-[11px] mt-1', msg.direction === 'OUTBOUND' ? 'text-white/60' : 'text-muted-foreground')}>
                        {timeAgo(msg.createdAt)}
                        {msg.fromFlow && ' • Fluxo'}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={bottomRef} />
            </div>

            {/* Input de mensagem */}
            <div className="p-4 border-t border-border bg-card/30 shrink-0">
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
                    placeholder="Digite uma mensagem... (Enter para enviar)"
                    className="flex-1 bg-input text-sm px-4 py-2.5 rounded-xl border border-border focus:border-primary outline-none"
                  />
                  <button
                    onClick={() => msgInput.trim() && sendMut.mutate(msgInput.trim())}
                    disabled={!msgInput.trim() || sendMut.isPending}
                    className="px-4 py-2.5 bg-primary text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3 mx-auto" />
              <p className="text-muted-foreground">Selecione uma conversa</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {conversations.length} conversa{conversations.length !== 1 ? 's' : ''} na lista
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
