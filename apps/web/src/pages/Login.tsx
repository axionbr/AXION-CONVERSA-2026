import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Loader2, LogIn, Moon, Sun } from 'lucide-react';
import { login } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useTheme } from '../context/ThemeContext';
import DeveloperSignature from '../components/DeveloperSignature';

export default function Login() {
  const [email, setEmail]       = useState('admin@axion.com');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const { setAuth }             = useAuthStore();
  const { theme, toggleTheme }  = useTheme();
  const navigate                = useNavigate();

  // dark mode → letras brancas; light mode → transparente (texto preto)
  const logoSrc = theme === 'dark'
    ? '/brand/logo-1-letras-brancas.png'
    : '/brand/logo-1-transparente.png';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await login(email, password);
      setAuth(data.token, data.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Credenciais inválidas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">

      {/* Ambient glow laranja */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/8 rounded-full blur-[120px]" />
      </div>

      {/* Botão de tema */}
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors z-10"
      >
        {theme === 'dark'
          ? <Sun  className="w-5 h-5" />
          : <Moon className="w-5 h-5" />
        }
      </button>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-[400px] relative z-10"
      >
        <div className="rounded-2xl border border-border p-8 shadow-2xl bg-card">

          {/* ── Logo Axion Conversa ──────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-8 select-none">
            <img
              src={logoSrc}
              alt="Axion Conversa"
              draggable={false}
              style={{
                height: '96px',        /* login: 80–110 px */
                width: 'auto',
                maxWidth: '240px',
                objectFit: 'contain',
              }}
            />
            <p className="text-[11px] text-muted-foreground mt-3 tracking-widest uppercase">
              Plataforma de Atendimento & Automação
            </p>
          </div>

          {/* ── Formulário ───────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5 uppercase tracking-wide">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-input text-sm pl-10 pr-4 py-2.5 rounded-lg border border-border focus:border-primary outline-none transition-colors"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground block mb-1.5 uppercase tracking-wide">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-input text-sm pl-10 pr-4 py-2.5 rounded-lg border border-border focus:border-primary outline-none transition-colors"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full gradient-orange text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60 glow-orange-sm mt-2"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <LogIn   className="w-4 h-4" />
              }
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          {/* Credenciais demo */}
          <div className="mt-5 p-3 bg-muted rounded-lg border border-border">
            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
              <strong className="text-foreground">Demo:</strong>{' '}
              admin@axion.com / admin123
            </p>
          </div>
        </div>

        {/* Assinatura Axion */}
        <div className="mt-4">
          <DeveloperSignature size="md" />
        </div>
      </motion.div>
    </div>
  );
}
