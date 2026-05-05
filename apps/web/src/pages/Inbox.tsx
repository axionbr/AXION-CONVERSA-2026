import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Send, Bot, Pause, UserCheck, User, MessageSquare } from 'lucide-react';
import {
  getConversations, getConversationMessages, sendMessage,
  assumeConversation, pauseAI, resumeAI,
} from '../lib/api';
import { getSocket, joinConversation, leaveConversation } from '../lib/socket';
import { cn, timeAgo, temperatureColor, modeLabel } from '../lib/utils';

export default function Inbox() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [msgInput, setMsgInput] = useState('');
  const [localMessages, setLocalMessages] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['conversations-inbox', search],
    queryFn: () => getConversations({ search, limit: 50 }),
    refetchInterval: 20_000,
  });
  const conversations = data?.conversations || [];
  const selected = conversations.find((c: any) => c.id === selectedId);

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', selectedId],
    queryFn: () => getConversationMessages(selectedId),
    enabled: !!selectedId,
  });

  useEffect(() => {
    setLocalMessages(messages);
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  useEffect(() => {
    const socket = getSocket();
    if (selectedId) {
      joinConversation(selectedId);
      socket.on('message:new', (data: any) => {
        if (data.conversationId === selectedId) {
          setLocalMessages(prev => {
            const exists = prev.some(m => m.id === data.message.id);
            return exists ? prev : [...prev, data.message];
          });
        }
        qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
      });
    }
    return () => {
      if (selectedId) leaveConversation(selectedId);
      socket.off('message:new');
    };
  }, [selectedId, qc]);

  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage(selectedId, content),
    onSuccess: (msg) => {
      setMsgInput('');
      setLocalMessages(prev => [...prev, msg]);
    },
  });

  const assumeMut = useMutation({ mutationFn: () => assumeConversation(selectedId), onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }) });
  const pauseMut = useMutation({ mutationFn: () => pauseAI(selectedId), onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }) });
  const resumeMut = useMutation({ mutationFn: () => resumeAI(selectedId), onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] }) });

  return (
    <div className="h-full flex">
      {/* Sidebar: conversation list */}
      <div className="w-72 shrink-0 flex flex-col border-r border-border bg-card/30">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar conversa..."
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
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={cn(
                    'w-full text-left p-3 border-b border-border/50 hover:bg-accent transition-colors',
                    selectedId === conv.id && 'bg-primary/10 border-l-2 border-l-primary'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full gradient-orange flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {conv.contact?.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">{conv.contact?.name}</p>
                        {conv.lead?.temperature && (
                          <span className={cn('text-xs px-1 rounded border ml-1', temperatureColor[conv.lead.temperature])}>
                            {conv.lead.temperature.slice(0, 4)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{lastMsg?.content || '...'}</p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat area */}
      {selectedId && selected ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full gradient-orange flex items-center justify-center text-white font-bold">
                {selected.contact?.name?.charAt(0)}
              </div>
              <div>
                <p className="font-semibold">{selected.contact?.name}</p>
                <p className="text-xs text-muted-foreground">{selected.contact?.phone}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => assumeMut.mutate()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs hover:bg-blue-500/25"
              >
                <UserCheck className="w-3.5 h-3.5" />
                Assumir
              </button>
              {selected.aiEnabled ? (
                <button
                  onClick={() => pauseMut.mutate()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 text-xs hover:bg-orange-500/25"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pausar IA
                </button>
              ) : (
                <button
                  onClick={() => resumeMut.mutate()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs hover:bg-green-500/25"
                >
                  <Bot className="w-3.5 h-3.5" />
                  Ativar IA
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <AnimatePresence initial={false}>
              {localMessages.map((msg: any) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
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
                    <p>{msg.content}</p>
                    <p className={cn('text-xs mt-1', msg.direction === 'OUTBOUND' ? 'text-white/60' : 'text-muted-foreground')}>
                      {timeAgo(msg.createdAt)}
                      {msg.fromFlow && ' • Fluxo'}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-border bg-card/30">
            <div className="flex gap-2">
              <input
                value={msgInput}
                onChange={e => setMsgInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && msgInput.trim()) { e.preventDefault(); sendMut.mutate(msgInput.trim()); } }}
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
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center">
          <div>
            <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3 mx-auto" />
            <p className="text-muted-foreground">Selecione uma conversa</p>
          </div>
        </div>
      )}
    </div>
  );
}
