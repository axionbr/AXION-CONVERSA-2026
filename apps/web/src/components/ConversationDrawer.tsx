import { motion, AnimatePresence } from 'framer-motion';
import { X, Bot, Pause, Play, User, UserCheck, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { assumeConversation, pauseAI, resumeAI, transferConversation, sendMessage } from '../lib/api';
import { cn, temperatureColor, timeAgo } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

interface Props {
  conversation: any;
  isOpen: boolean;
  onClose: () => void;
}

export default function ConversationDrawer({ conversation, isOpen, onClose }: Props) {
  const [msg, setMsg] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['live-conversations'] });
    qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
  };

  const assumeMut = useMutation({ mutationFn: () => assumeConversation(conversation.id), onSuccess: invalidate });
  const pauseMut = useMutation({ mutationFn: () => pauseAI(conversation.id), onSuccess: invalidate });
  const resumeMut = useMutation({ mutationFn: () => resumeAI(conversation.id), onSuccess: invalidate });
  const sendMut = useMutation({
    mutationFn: (content: string) => sendMessage(conversation.id, content),
    onSuccess: () => { setMsg(''); invalidate(); },
  });

  if (!conversation) return null;

  const { contact, lead, store, assignedUser, messages, aiEnabled, mode } = conversation;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full gradient-orange flex items-center justify-center text-white font-bold">
                  {contact?.name?.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold">{contact?.name}</p>
                  <p className="text-xs text-muted-foreground">{contact?.phone}</p>
                </div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Lead info */}
            <div className="p-4 border-b border-border space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {lead?.temperature && (
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium border', temperatureColor[lead.temperature])}>
                    {lead.temperature}
                  </span>
                )}
                {lead?.score != null && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary border border-primary/30">
                    Score: {lead.score}
                  </span>
                )}
                {store && (
                  <span className="text-xs text-muted-foreground">{store.name}</span>
                )}
              </div>

              {lead?.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {lead.tags.map((lt: any) => (
                    <span
                      key={lt.tag.id}
                      className="px-2 py-0.5 rounded text-xs"
                      style={{ background: lt.tag.color + '20', color: lt.tag.color }}
                    >
                      {lt.tag.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                {assignedUser ? `Atendente: ${assignedUser.name}` : 'Sem atendente'}
                {' • '}
                {aiEnabled ? <span className="text-blue-400">IA Ativa</span> : <span className="text-gray-400">IA Pausada</span>}
              </div>
            </div>

            {/* Messages preview */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-muted-foreground font-medium mb-2">Últimas mensagens</p>
              {messages?.slice(-10).map((m: any) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex',
                    m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[80%] px-3 py-2 rounded-xl text-sm',
                      m.direction === 'OUTBOUND'
                        ? 'bg-primary text-white rounded-br-sm'
                        : 'bg-muted text-foreground rounded-bl-sm',
                      m.fromFlow && 'ring-1 ring-blue-400/50'
                    )}
                  >
                    <p>{m.content}</p>
                    <p className={cn(
                      'text-xs mt-1',
                      m.direction === 'OUTBOUND' ? 'text-white/60' : 'text-muted-foreground'
                    )}>
                      {timeAgo(m.createdAt)}
                      {m.fromFlow && ' • Fluxo'}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Send message */}
            <div className="p-4 border-t border-border">
              <div className="flex gap-2 mb-3">
                <input
                  value={msg}
                  onChange={e => setMsg(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && msg && sendMut.mutate(msg)}
                  placeholder="Digite uma mensagem..."
                  className="flex-1 bg-input text-sm px-3 py-2 rounded-lg border border-border focus:border-primary outline-none"
                />
                <button
                  onClick={() => msg && sendMut.mutate(msg)}
                  disabled={!msg || sendMut.isPending}
                  className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Enviar
                </button>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => assumeMut.mutate()}
                  disabled={assumeMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs font-medium hover:bg-blue-500/25 transition-colors"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Assumir
                </button>

                {aiEnabled ? (
                  <button
                    onClick={() => pauseMut.mutate()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 text-xs font-medium hover:bg-orange-500/25 transition-colors"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pausar IA
                  </button>
                ) : (
                  <button
                    onClick={() => resumeMut.mutate()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-medium hover:bg-green-500/25 transition-colors"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    Ativar IA
                  </button>
                )}

                <button
                  onClick={() => navigate('/inbox')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-accent transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir Inbox
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
