import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Search, Plus, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { getLeads, updateLead } from '../lib/api';
import { cn, temperatureColor, temperatureIcon, statusColor, timeAgo } from '../lib/utils';

export default function Leads() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [temperature, setTemperature] = useState('');
  const [status, setStatus] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['leads', page, search, temperature, status],
    queryFn: () => getLeads({ page, limit: 20, search, temperature, status }),
  });

  const leads = data?.leads || [];
  const total = data?.total || 0;
  const pages = Math.ceil(total / 20);

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateLead(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
        <div>
          <h1 className="text-lg font-bold">Leads</h1>
          <p className="text-xs text-muted-foreground">{total} leads cadastrados</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90">
          <Plus className="w-4 h-4" />
          Novo Lead
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar lead..."
            className="bg-input text-sm pl-9 pr-3 py-1.5 rounded-lg border border-border outline-none focus:border-primary w-48"
          />
        </div>
        <select
          value={temperature}
          onChange={e => { setTemperature(e.target.value); setPage(1); }}
          className="text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none"
        >
          <option value="">Temperatura</option>
          {['FRIO', 'MORNO', 'QUENTE', 'URGENTE'].map(t => <option key={t}>{t}</option>)}
        </select>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="text-xs bg-input border border-border rounded-lg px-2 py-1.5 outline-none"
        >
          <option value="">Status</option>
          {['NOVO', 'EM_CONTATO', 'QUALIFICADO', 'PROPOSTA', 'FECHADO', 'PERDIDO'].map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr>
                {['Nome', 'Telefone', 'Temperatura', 'Score', 'Status', 'Loja', 'Atendente', 'Criado'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead: any) => (
                <motion.tr
                  key={lead.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border-b border-border/50 hover:bg-accent transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{lead.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.phone}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs border', temperatureColor[lead.temperature])}>
                      {temperatureIcon[lead.temperature]} {lead.temperature}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full gradient-orange rounded-full transition-all"
                          style={{ width: `${lead.score}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{lead.score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs border', statusColor[lead.status] || 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{lead.store?.name || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{lead.assignedUser?.name || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{timeAgo(lead.createdAt)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 p-4 border-t border-border">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-muted-foreground">Página {page} de {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages} className="p-1 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
