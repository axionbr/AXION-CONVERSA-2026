import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, Users, Phone, KanbanSquare,
  GitBranch, Settings, LogOut, Moon, Sun, ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../context/ThemeContext';
import DeveloperSignature from './DeveloperSignature';
import { cn } from '../lib/utils';

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inbox',     icon: MessageSquare,   label: 'Inbox' },
  { to: '/leads',     icon: Users,           label: 'Leads' },
  { to: '/contacts',  icon: Phone,           label: 'Contatos' },
  { to: '/crm',       icon: KanbanSquare,    label: 'CRM' },
  { to: '/flows',     icon: GitBranch,       label: 'Fluxos' },
  { to: '/settings',  icon: Settings,        label: 'Configurações' },
];

const roleLabel: Record<string, string> = {
  ADMIN:     'Administrador',
  DIRETOR:   'Diretor',
  GERENTE:   'Gerente',
  VENDEDOR:  'Vendedor',
  ATENDENTE: 'Atendente',
};

export default function Sidebar() {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // dark mode → letras brancas (texto branco + moto laranja, legível no fundo escuro)
  // light mode → transparente (texto preto + moto laranja, legível no fundo claro)
  const logoSrc = theme === 'dark'
    ? '/brand/logo-1-letras-brancas.png'
    : '/brand/logo-1-transparente.png';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <aside className="w-16 lg:w-60 flex flex-col shrink-0 border-r border-border bg-card">

      {/* ── Logo Tecle Motos ──────────────────────────────────────────────── */}
      {/* h-14 = 56px de altura da header → logo com 44px deixa 6px de padding */}
      <div className="h-14 flex items-center justify-center px-2 border-b border-border shrink-0">
        <img
          src={logoSrc}
          alt="Tecle Motos"
          draggable={false}
          style={{
            height: '44px',          /* sidebar: 42–56 px */
            width: 'auto',
            maxWidth: '140px',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* ── Navegação ─────────────────────────────────────────────────────── */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn(
                  'w-[18px] h-[18px] shrink-0 transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                )} />
                <span className="hidden lg:block flex-1">{label}</span>
                {isActive && (
                  <ChevronRight className="hidden lg:block w-3.5 h-3.5 text-primary/60 shrink-0" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Rodapé ────────────────────────────────────────────────────────── */}
      <div className="p-2 border-t border-border space-y-1 shrink-0">

        {/* Botão de tema */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-sm font-medium"
        >
          {theme === 'dark'
            ? <Sun  className="w-[18px] h-[18px] shrink-0" />
            : <Moon className="w-[18px] h-[18px] shrink-0" />
          }
          <span className="hidden lg:block">
            {theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
          </span>
        </button>

        {/* Usuário */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent transition-colors">
          <div className="w-7 h-7 rounded-full gradient-orange flex items-center justify-center text-white text-xs font-bold shrink-0">
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="hidden lg:flex flex-col flex-1 min-w-0">
            <p className="text-xs font-semibold truncate leading-tight">{user?.name}</p>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">
              {roleLabel[user?.role || ''] || user?.role}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Assinatura Axion — visível apenas no sidebar expandido */}
        <div className="hidden lg:block pt-1 pb-0.5">
          <DeveloperSignature size="sm" />
        </div>
      </div>
    </aside>
  );
}
