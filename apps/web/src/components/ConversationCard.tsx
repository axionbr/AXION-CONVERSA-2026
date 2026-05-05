import { motion, AnimatePresence } from 'framer-motion';
import { Bot, User, Pause, Flame, Snowflake, Sun, AlertTriangle, Clock } from 'lucide-react';
import { cn, timeAgo, formatPhone, temperatureColor, modeLabel } from '../lib/utils';
import { useState } from 'react';

interface Props {
  conversation: any;
  onClick?: () => void;
  newMessage?: { content: string; id: string } | null;
}

const TempIcon = ({ temp }: { temp: string }) => {
  if (temp === 'FRIO') return <Snowflake className="w-3 h-3" />;
  if (temp === 'MORNO') return <Sun className="w-3 h-3" />;
  if (temp === 'QUENTE') return <Flame className="w-3 h-3" />;
  return <AlertTriangle className="w-3 h-3" />;
};

export default function ConversationCard({ conversation, onClick, newMessage }: Props) {
  const { contact, lead, assignedUser, store, messages, mode, aiEnabled, status } = conversation;
  const lastMsg = messages?.[0];
  const temp = lead?.temperature || 'FRIO';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      className={cn(
        'glass glass-hover rounded-xl p-4 cursor-pointer relative overflow-hidden transition-all',
        status === 'AGUARDANDO' && 'border-yellow-500/40',
        temp === 'URGENTE' && 'border-red-500/40 animate-pulse-glow'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full gradient-orange flex items-center justify-center text-white text-sm font-bold shrink-0">
            {contact?.name?.charAt(0) || '?'}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{contact?.name || 'Desconhecido'}</p>
            <p className="text-xs text-muted-foreground">{formatPhone(contact?.phone || '')}</p>
          </div>
        </div>

        <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border shrink-0', temperatureColor[temp])}>
          <TempIcon temp={temp} />
          <span>{temp}</span>
        </div>
      </div>

      {/* Store & Agent */}
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        {store && <span className="truncate">{store.name}</span>}
        {assignedUser && (
          <>
            <span>•</span>
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {assignedUser.name}
            </span>
          </>
        )}
        {lead?.score != null && (
          <>
            <span>•</span>
            <span className="text-primary font-semibold">Score {lead.score}</span>
          </>
        )}
      </div>

      {/* Last message */}
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
        {lastMsg?.content || 'Sem mensagens'}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
            aiEnabled ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-500/15 text-gray-400'
          )}>
            {aiEnabled ? <Bot className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span>{modeLabel[mode] || mode}</span>
          </div>
          {lead?.tags?.slice(0, 2).map((lt: any) => (
            <span
              key={lt.tag.id}
              className="px-1.5 py-0.5 rounded text-xs"
              style={{ background: lt.tag.color + '20', color: lt.tag.color }}
            >
              {lt.tag.name}
            </span>
          ))}
        </div>
        {lastMsg && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeAgo(lastMsg.createdAt)}
          </span>
        )}
      </div>

      {/* New message balloon */}
      <AnimatePresence>
        {newMessage && (
          <motion.div
            key={newMessage.id}
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.9 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="absolute bottom-0 left-0 right-0 p-3 bg-primary/90 backdrop-blur rounded-b-xl"
          >
            <p className="text-xs text-white font-medium truncate">
              💬 {newMessage.content}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
