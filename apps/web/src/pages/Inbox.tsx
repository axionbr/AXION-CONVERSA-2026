import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Send, Bot, Pause, UserCheck, MessageSquare,
  Clock, X, RefreshCw, Sparkles, ChevronRight, Flame,
  Loader2, Copy, CheckCheck,
} from 'lucide-react';
import {
  getConversations, getConversationMessages, sendMessage,
  assumeConversation, pauseAI, resumeAI,
  closeConversation, waitConversation, markConversationRead,
  getConversationAnalysis, requestConversationAnalysis,
} from '../lib/api';
import { getSocket, joinConversation, leaveConversation } from '../lib/socket';
import { cn, timeAgo, temperatureColor, modeLabel, statusColor, statusLabel } from '../lib/utils';

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

function resolveSenderType(msg: any): 'CLIENT' | 'AGENT' | 'AI' | 'FLOW' {
  if (msg.senderType === 'AI')    return 'AI';
  if (msg.senderType === 'FLOW')  return 'FLOW';
  if (msg.senderType === 'AGENT') return 'AGENT';
  if (msg.direction === 'INBOUND') return 'CLIENT';
  return 'AGENT';
}

export default function Inbox() {
  const [statusFilter, setStatusFilter]   = useState('');
  const [search, setSearch]               = useState('');
  const [selectedId, setSelectedId]       = useState<string>('');
  const [msgInput, setMsgInput]           = useState('');
  const [localMessages, setLocalMessages] = useState<any[]>([]);
  const [showAnalysis, setShowAnalysis]   = useState(true);
  const [copied, setCopied]               = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc        = useQueryClient();

  // Lista de conversas
  const { data, isError, refetch, isFetching } = useQuery({
    queryKey:        ['conversations-inbox', statusFilter, search],
    queryFn:         () => getConversations({ status: statusFilter || undefined, search: search || undefined, limit: 60 }),
    refetchInterval: 10_000,
    retry:           2,
  });

  const conversations = data?.conversations ?? [];
  const selected      = conversations.find((c: any) => c.id === selectedId);

  // Mensagens da conversa aberta
  const { data: messages = [] } = useQuery({
    queryKey: ['messages', selectedId],
    queryFn:  () => getConversationMessages(selectedId),
    enabled:  !!selectedId,
  });

  // Analise IA da conversa selecionada
  const { data: analysisData, refetch: refetchAnalysis } = useQuery({
    queryKey: ['analysis', selectedId],
    queryFn:  () => getConversationAnalysis(selectedId),
    enabled:  !!selectedId,
    staleTime: 60_000,
  });

  const analysis = analysisData?.analysis ?? null;

  const analyzeMut = useMutation({
    mutationFn: () => requestConversationAnalysis(selectedId),
    onSuccess: () => refetchAnalysis(),
  });

  useEffect(() => { setLocalMessages(messages); }, [messages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [localMessages]);

  // Socket: listeners globais
  useEffect(() => {
    const socket = getSocket();
    const onMsgNew     = () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    const onConvNew    = () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    const onConvUpdate = () => qc.invalidateQueries({ queryKey: ['conversations-inbox'] });

    socket.on('message:new',          onMsgNew);
    socket.on('conversation:new',     onConvNew);
    socket.on('conversation:updated', onConvUpdate);

    return () => {
      socket.off('message:new',          onMsgNew);
      socket.off('conversation:new',     onConvNew);
      socket.off('conversation:updated', onConvUpdate);
    };
  }, [qc]);

  // Socket: listener da conversa aberta
  useEffect(() => {
    if (!selectedId) return;
    const socket = getSocket();
    joinConversation(selectedId);

    function onMsgInChat(data: any) {
      if (data.conversationId !== selectedId) return;
      setLocalMessages(prev => {
        const exists = prev.some((m: any) => m.id === data.message.id);
        return exists ? prev : [...prev, data.message];
      });
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    }

    function onConvUpdatedInChat(data: any) {
      if (data.conversationId !== selectedId) return;
      qc.invalidateQueries({ queryKey: ['conversations-inbox'] });
    }

    socket.on('message:new', onMsgInChat);
    socket.on('conversation:updated', onConvUpdatedInChat);

    return () => {
      leaveConversation(selectedId);
      socket.off('message:new', onMsgInChat);
      socket.off('conversation:updated', onConvUpdatedInChat);
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
    if (analysis?.respostaSugerida) {
      setMsgInput(analysis.respostaSugerida);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Mutations
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
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto mr-1 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
        </button>
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
            {isError ? (
              <div className="text-center text-destructive text-sm py-8 px-3">
                <p>Erro ao carregar conversas.</p>
                <button onClick={() => refetch()} className="mt-2 underline text-xs">Tentar novamente</button>
              </div>
            ) : conversations.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8">
                {isFetching ? 'Carregando...' : 'Nenhuma conversa'}
              </p>
            ) : (
              conversations.map((conv: any) => {
                const lastMsg    = conv.messages?.[0];
                const unread     = conv.unreadCount || 0;
                const isOutbound = lastMsg?.direction === 'OUTBOUND';
                const lastSender = lastMsg?.senderType === 'AI' ? 'IA: '
                                 : isOutbound                   ? '↩ ' : '';

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
                      <div className="relative shrink-0">
                        <div className="w-9 h-9 rounded-full gradient-orange flex items-center justify-center text-white text-xs font-bold">
                          {conv.contact?.name?.charAt(0)?.toUpperCase() ?? '?'}
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

        {/* Area de chat */}
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
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{selected.contact?.name}</p>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded border shrink-0', statusColor[selected.status] ?? '')}>
                        {statusLabel[selected.status] ?? selected.status}
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
                        <span>• <span className="text-foreground/80">{selected.assignedUser.name}</span></span>
                      )}
                      <span className="px-1.5 py-0.5 rounded bg-accent text-[10px]">
                        {modeLabel[selected.mode] ?? selected.mode}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {selected.status !== 'FECHADO' && (
                    <>
                      <button
                        onClick={() => assumeMut.mutate()}
                        disabled={assumeMut.isPending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs hover:bg-blue-500/25 disabled:opacity-50 transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Assumir
                      </button>
                      {selected.aiEnabled ? (
                        <button onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 text-xs hover:bg-orange-500/25 disabled:opacity-50 transition-colors">
                          <Pause className="w-3.5 h-3.5" /> Pausar IA
                        </button>
                      ) : (
                        <button onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs hover:bg-green-500/25 disabled:opacity-50 transition-colors">
                          <Bot className="w-3.5 h-3.5" /> Ativar IA
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
                  {/* Toggle painel IA */}
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
                          {senderType === 'AI' && <Bot className="w-3 h-3 text-blue-400" />}
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

              {/* Input */}
              <div className="p-4 border-t border-border bg-card/30 shrink-0">
                {selected.status === 'FECHADO' ? (
                  <p className="text-center text-sm text-muted-foreground py-1">
                    Conversa fechada — nao e possivel enviar mensagens
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

            {/* Painel de analise IA */}
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
                  {/* Header do painel */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">Analise IA</span>
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
                        <p className="text-sm text-muted-foreground">Sem analise ainda</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          Clique em "Analisar" para obter insights com IA
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Tipo e temperatura */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs px-2 py-1 rounded-full bg-[#2a2a2a] border border-border text-foreground">
                            {TIPO_LABEL[analysis.tipo] ?? analysis.tipo}
                          </span>
                          <span className={cn('text-xs px-2 py-1 rounded-full border', TEMP_COLORS[analysis.temperatura] ?? '')}>
                            <Flame className="w-2.5 h-2.5 inline mr-0.5" />
                            {analysis.temperatura}
                          </span>
                        </div>

                        {/* Resumo */}
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-medium">Resumo</p>
                          <p className="text-xs text-foreground/90 leading-relaxed">{analysis.resumo}</p>
                        </div>

                        {/* Proxima acao */}
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <p className="text-[10px] text-primary uppercase tracking-wider mb-1 font-medium flex items-center gap-1">
                            <ChevronRight className="w-3 h-3" /> Proxima acao
                          </p>
                          <p className="text-xs text-foreground/90">{analysis.proximaAcao}</p>
                        </div>

                        {/* Resposta sugerida */}
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-blue-400 uppercase tracking-wider font-medium flex items-center gap-1">
                              <Bot className="w-3 h-3" /> Resposta sugerida
                            </p>
                            <button
                              onClick={() => copyToClipboard(analysis.respostaSugerida)}
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
