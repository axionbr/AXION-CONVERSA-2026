import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Plus, Play, Pause, Copy, Trash2, GitBranch, Zap, Clock, CheckCircle, XCircle } from 'lucide-react';
import { getFlows, createFlow, toggleFlow, duplicateFlow, deleteFlow } from '../lib/api';
import { timeAgo, cn } from '../lib/utils';
import { useState } from 'react';

export default function Flows() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<string>('');

  const { data: flows = [], isLoading } = useQuery({
    queryKey: ['flows'],
    queryFn: getFlows,
  });

  const createMut = useMutation({
    mutationFn: () => createFlow({ name: 'Novo Fluxo' }),
    onSuccess: (flow) => { qc.invalidateQueries({ queryKey: ['flows'] }); navigate(`/flows/${flow.id}/edit`); },
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => toggleFlow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flows'] }),
    onError: (err: any) => alert(err.response?.data?.error || 'Erro ao ativar fluxo'),
  });

  const dupMut = useMutation({
    mutationFn: (id: string) => duplicateFlow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flows'] }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFlow(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['flows'] }); setConfirmDelete(''); },
  });

  const triggerLabels: Record<string, string> = {
    FIRST_MESSAGE: 'Primeira Mensagem',
    KEYWORD: 'Palavra-chave',
    TAG_APPLIED: 'Tag Aplicada',
    TEMPERATURE_CHANGED: 'Temperatura Alterada',
    LEAD_CREATED: 'Lead Criado',
    STATUS_CHANGED: 'Status Alterado',
    NO_RESPONSE: 'Sem Resposta',
    AFTER_HOURS: 'Fora de Horário',
    CAMPAIGN_STARTED: 'Campanha',
    EXTERNAL_WEBHOOK: 'Webhook Externo',
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
        <div>
          <h1 className="text-lg font-bold">Fluxos de Conversa</h1>
          <p className="text-xs text-muted-foreground">Crie automações inteligentes para WhatsApp</p>
        </div>
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
          className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          <Plus className="w-4 h-4" />
          Novo Fluxo
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : flows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <GitBranch className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum fluxo criado</p>
            <p className="text-sm text-muted-foreground/60 mb-4">Crie seu primeiro fluxo de automação</p>
            <button
              onClick={() => createMut.mutate()}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              Criar Fluxo
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {flows.map((flow: any) => (
                <motion.div
                  key={flow.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={cn(
                    'glass rounded-xl p-4 border',
                    flow.active ? 'border-green-500/30' : 'border-border'
                  )}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        flow.active ? 'bg-green-500/20' : 'bg-muted'
                      )}>
                        <GitBranch className={cn('w-4 h-4', flow.active ? 'text-green-400' : 'text-muted-foreground')} />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{flow.name}</p>
                        <p className="text-xs text-muted-foreground">v{flow.version}</p>
                      </div>
                    </div>
                    <div className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                      flow.active ? 'bg-green-500/15 text-green-400' : 'bg-muted text-muted-foreground'
                    )}>
                      {flow.active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {flow.active ? 'Ativo' : 'Inativo'}
                    </div>
                  </div>

                  {/* Description */}
                  {flow.description && (
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{flow.description}</p>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {flow.nodes?.length || 0} nós
                    </span>
                    <span className="flex items-center gap-1">
                      <Play className="w-3 h-3" />
                      {flow._count?.executions || 0} execuções
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(flow.updatedAt)}
                    </span>
                  </div>

                  {/* Triggers */}
                  {flow.triggers?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {flow.triggers.slice(0, 3).map((t: any) => (
                        <span key={t.id} className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded">
                          {t.value ? `"${t.value}"` : triggerLabels[t.type] || t.type}
                        </span>
                      ))}
                      {flow.triggers.length > 3 && (
                        <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded">
                          +{flow.triggers.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                    <button
                      onClick={() => navigate(`/flows/${flow.id}/edit`)}
                      className="flex-1 text-xs py-1.5 bg-muted hover:bg-accent rounded-lg transition-colors text-center font-medium"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => toggleMut.mutate(flow.id)}
                      className={cn(
                        'p-1.5 rounded-lg transition-colors',
                        flow.active ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25' : 'bg-muted text-muted-foreground hover:bg-accent'
                      )}
                      title={flow.active ? 'Desativar' : 'Ativar'}
                    >
                      {flow.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => dupMut.mutate(flow.id)}
                      className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-accent transition-colors"
                      title="Duplicar"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(flow.id)}
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Confirm delete modal */}
      <AnimatePresence>
        {confirmDelete && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setConfirmDelete('')}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl p-6 w-80"
            >
              <p className="font-semibold mb-2">Excluir fluxo?</p>
              <p className="text-sm text-muted-foreground mb-4">Esta ação não pode ser desfeita.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete('')} className="flex-1 py-2 bg-muted rounded-lg text-sm hover:bg-accent">
                  Cancelar
                </button>
                <button
                  onClick={() => delMut.mutate(confirmDelete)}
                  disabled={delMut.isPending}
                  className="flex-1 py-2 bg-destructive text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-60"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
