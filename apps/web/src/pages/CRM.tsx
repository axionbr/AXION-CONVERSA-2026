import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { getLeads, updateLead } from '../lib/api';
import { cn, temperatureColor, temperatureIcon } from '../lib/utils';

const COLUMNS = [
  { key: 'NOVO', label: 'Novos', color: 'border-blue-500/30 bg-blue-500/5' },
  { key: 'EM_CONTATO', label: 'Em Contato', color: 'border-yellow-500/30 bg-yellow-500/5' },
  { key: 'QUALIFICADO', label: 'Qualificados', color: 'border-orange-500/30 bg-orange-500/5' },
  { key: 'PROPOSTA', label: 'Proposta', color: 'border-purple-500/30 bg-purple-500/5' },
  { key: 'FECHADO', label: 'Fechados', color: 'border-green-500/30 bg-green-500/5' },
  { key: 'PERDIDO', label: 'Perdidos', color: 'border-red-500/30 bg-red-500/5' },
];

export default function CRM() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['leads-crm'],
    queryFn: () => getLeads({ limit: 200 }),
  });
  const leads = data?.leads || [];

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateLead(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads-crm'] }),
  });

  const [dragId, setDragId] = useState<string>('');

  function handleDrop(e: React.DragEvent, status: string) {
    e.preventDefault();
    if (dragId) updateMut.mutate({ id: dragId, status });
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border bg-card/50">
        <h1 className="text-lg font-bold">CRM Kanban</h1>
        <p className="text-xs text-muted-foreground">Arraste os leads entre as colunas</p>
      </div>

      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 min-w-max h-full">
          {COLUMNS.map(col => {
            const colLeads = leads.filter((l: any) => l.status === col.key);
            return (
              <div
                key={col.key}
                className={cn('w-64 flex flex-col rounded-xl border', col.color)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleDrop(e, col.key)}
              >
                <div className="p-3 border-b border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{col.label}</span>
                    <span className="text-xs text-muted-foreground bg-white/5 rounded-full px-2 py-0.5">
                      {colLeads.length}
                    </span>
                  </div>
                </div>

                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {colLeads.map((lead: any) => (
                    <motion.div
                      key={lead.id}
                      layout
                      draggable
                      onDragStart={() => setDragId(lead.id)}
                      onDragEnd={() => setDragId('')}
                      className="glass glass-hover rounded-lg p-3 cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between mb-1">
                        <p className="font-medium text-sm truncate flex-1">{lead.name}</p>
                        <span className="text-xs ml-1">{temperatureIcon[lead.temperature]}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{lead.phone}</p>
                      <div className="flex items-center justify-between">
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-full border', temperatureColor[lead.temperature])}>
                          {lead.temperature}
                        </span>
                        <div className="flex items-center gap-1">
                          <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
                            <div className="h-full gradient-orange" style={{ width: `${lead.score}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{lead.score}</span>
                        </div>
                      </div>
                      {lead.assignedUser && (
                        <p className="text-xs text-muted-foreground mt-1.5 truncate">{lead.assignedUser.name}</p>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
