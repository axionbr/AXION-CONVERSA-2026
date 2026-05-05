import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Phone, ChevronLeft, ChevronRight } from 'lucide-react';
import { getContacts } from '../lib/api';
import { formatPhone, timeAgo } from '../lib/utils';

export default function Contacts() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', page, search],
    queryFn: () => getContacts({ page, limit: 20, search }),
  });

  const contacts = data?.contacts || [];
  const total = data?.total || 0;
  const pages = Math.ceil(total / 20);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
        <div>
          <h1 className="text-lg font-bold">Contatos</h1>
          <p className="text-xs text-muted-foreground">{total} contatos</p>
        </div>
      </div>

      <div className="px-6 py-3 border-b border-border">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar contato..."
            className="w-full bg-input text-sm pl-9 pr-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr>
                {['Nome', 'Telefone', 'Email', 'Criado'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c: any) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-accent transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full gradient-orange flex items-center justify-center text-white text-xs font-bold">
                        {c.name?.charAt(0)}
                      </div>
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" />
                    {formatPhone(c.phone)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{timeAgo(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
