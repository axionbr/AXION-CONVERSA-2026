import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Phone, User, Flame, TrendingUp, MoreHorizontal, Plus, Search } from 'lucide-react';
import { getLeads, updateLead } from '../lib/api';
import { cn, temperatureColor, temperatureIcon } from '../lib/utils';

const COLUMNS = [
  { key: 'NOVO_LEAD',            label: 'Novo Lead',          color: 'border-blue-500/40',   header: 'bg-blue-500/10',  dot: 'bg-blue-400' },
  { key: 'QUALIFICADO',          label: 'Qualificado',         color: 'border-cyan-500/40',   header: 'bg-cyan-500/10',  dot: 'bg-cyan-400' },
  { key: 'EM_NEGOCIACAO',        label: 'Em Negociacao',       color: 'border-orange-500/40', header: 'bg-orange-500/10',dot: 'bg-orange-400' },
  { key: 'AGUARDANDO_PAGAMENTO', label: 'Aguard. Pagamento',   color: 'border-yellow-500/40', header: 'bg-yellow-500/10',dot: 'bg-yellow-400' },
  { key: 'VENDA_FECHADA',        label: 'Venda Fechada',       color: 'border-green-500/40',  header: 'bg-green-500/10', dot: 'bg-green-400' },
  { key: 'PERDIDO',              label: 'Perdido',             color: 'border-red-500/40',    header: 'bg-red-500/10',   dot: 'bg-red-400' },
  { key: 'POS_VENDA',            label: 'Pos-venda',           color: 'border-purple-500/40', header: 'bg-purple-500/10',dot: 'bg-purple-400' },
];

const SOURCE_LABELS: Record<string, string> = {
  WhatsApp: 'WhatsApp', Instagram: 'Instagram', Facebook: 'Facebook',
  Site: 'Site', Indicacao: 'Indicacao', Loja: 'Loja',
};

function LeadCard({ lead, onDragStart }: { lead: any; onDragStart: (id: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      layout
      draggable
      onDragStart={() => onDragStart(lead.id)}
      className="bg-[#2a2a2a] border border-[#343434] rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors group"
    >
      {/* Header do card */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-[#f5f5f5] truncate">{lead.name}</p>
          <p className="text-xs text-[#b3b3b3] flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3" /> {lead.phone}
          </p>
        </div>
        <span className="text-base ml-2 shrink-0">{temperatureIcon[lead.temperature] ?? ''}</span>
      </div>

      {/* Tags de info */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', temperatureColor[lead.temperature])}>
          {lead.temperature}
        </span>
        {lead.source && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#343434] text-[#b3b3b3] border border-[#3a3a3a]">
            {SOURCE_LABELS[lead.source] ?? lead.source}
          </span>
        )}
        {lead.interest && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 truncate max-w-[100px]">
            {lead.interest}
          </span>
        )}
      </div>

      {/* Score */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1 bg-[#343434] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-primary rounded-full transition-all"
            style={{ width: `${Math.min(100, lead.score)}%` }}
          />
        </div>
        <span className="text-[10px] text-[#b3b3b3] shrink-0">{lead.score}pts</span>
      </div>

      {/* Responsavel e regiao */}
      <div className="flex items-center justify-between text-[10px] text-[#b3b3b3]">
        <div className="flex items-center gap-1">
          {lead.assignedUser ? (
            <>
              <User className="w-3 h-3" />
              <span className="truncate max-w-[80px]">{lead.assignedUser.name}</span>
            </>
          ) : (
            <span>Sem responsavel</span>
          )}
        </div>
        {lead.region && (
          <span className="truncate max-w-[80px]">{lead.region}</span>
        )}
      </div>
    </motion.div>
  );
}

export default function CRM() {
  const qc = useQueryClient();
  const [dragId, setDragId]     = useState<string>('');
  const [dragOver, setDragOver] = useState<string>('');
  const [search, setSearch]     = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['leads-crm', search],
    queryFn:  () => getLeads({ limit: 300, search: search || undefined }),
  });

  const leads: any[] = data?.leads ?? [];

  const moveMut = useMutation({
    mutationFn: ({ id, kanbanStage }: { id: string; kanbanStage: string }) =>
      updateLead(id, { kanbanStage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads-crm'] }),
  });

  function handleDrop(e: React.DragEvent, colKey: string) {
    e.preventDefault();
    setDragOver('');
    if (dragId && dragId !== '') {
      moveMut.mutate({ id: dragId, kanbanStage: colKey });
      setDragId('');
    }
  }

  // Agrupa leads: usa kanbanStage se existir, senao mapeia status antigo
  const STATUS_MAP: Record<string, string> = {
    NOVO: 'NOVO_LEAD', EM_CONTATO: 'QUALIFICADO', QUALIFICADO: 'QUALIFICADO',
    PROPOSTA: 'EM_NEGOCIACAO', FECHADO: 'VENDA_FECHADA', PERDIDO: 'PERDIDO',
  };

  function getLeadStage(lead: any): string {
    if (lead.kanbanStage) return lead.kanbanStage;
    return STATUS_MAP[lead.status] ?? 'NOVO_LEAD';
  }

  const total = leads.length;

  return (
    <div className="h-full flex flex-col bg-[#212121]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#343434]">
        <div>
          <h1 className="text-lg font-bold text-[#f5f5f5]">CRM Kanban</h1>
          <p className="text-xs text-[#b3b3b3]">{total} lead{total !== 1 ? 's' : ''} • Arraste para mover entre etapas</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#b3b3b3]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar lead..."
            className="bg-[#2a2a2a] border border-[#343434] text-sm text-[#f5f5f5] pl-9 pr-3 py-2 rounded-lg outline-none focus:border-primary w-48 placeholder-[#b3b3b3]"
          />
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map(col => {
              const colLeads = leads.filter(l => getLeadStage(l) === col.key);
              const isDragTarget = dragOver === col.key;

              return (
                <div
                  key={col.key}
                  className={cn(
                    'w-64 flex flex-col rounded-xl border transition-colors',
                    'bg-[#1e1e1e]',
                    col.color,
                    isDragTarget && 'ring-1 ring-primary ring-offset-1 ring-offset-[#212121]'
                  )}
                  onDragOver={e => { e.preventDefault(); setDragOver(col.key); }}
                  onDragLeave={() => setDragOver('')}
                  onDrop={e => handleDrop(e, col.key)}
                >
                  {/* Cabecalho da coluna */}
                  <div className={cn('px-3 py-2.5 rounded-t-xl border-b border-[#343434]', col.header)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-2 h-2 rounded-full', col.dot)} />
                        <span className="text-sm font-semibold text-[#f5f5f5]">{col.label}</span>
                      </div>
                      <span className="text-xs text-[#b3b3b3] bg-[#2a2a2a] rounded-full px-2 py-0.5 border border-[#343434]">
                        {colLeads.length}
                      </span>
                    </div>
                    {/* Mini progresso */}
                    {colLeads.length > 0 && (
                      <div className="mt-2 h-0.5 bg-[#343434] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full"
                          style={{ width: `${Math.min(100, (colLeads.length / Math.max(1, total)) * 100 * 3)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                    {colLeads.length === 0 ? (
                      <div className={cn(
                        'flex flex-col items-center justify-center py-8 rounded-lg border-2 border-dashed transition-colors text-center',
                        isDragTarget ? 'border-primary/40 bg-primary/5' : 'border-[#343434]'
                      )}>
                        <Plus className="w-5 h-5 text-[#b3b3b3]/50 mb-1" />
                        <p className="text-[10px] text-[#b3b3b3]/50">Solte aqui</p>
                      </div>
                    ) : (
                      colLeads.map(lead => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          onDragStart={setDragId}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
