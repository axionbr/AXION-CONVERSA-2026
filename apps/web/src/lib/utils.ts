import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR });
}

export function formatPhone(phone: string) {
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 11) return `(${clean.slice(0,2)}) ${clean.slice(2,7)}-${clean.slice(7)}`;
  if (clean.length === 10) return `(${clean.slice(0,2)}) ${clean.slice(2,6)}-${clean.slice(6)}`;
  return phone;
}

export const temperatureColor: Record<string, string> = {
  FRIO: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  MORNO: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  QUENTE: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  URGENTE: 'text-red-400 bg-red-400/10 border-red-400/30 animate-pulse',
};

export const temperatureIcon: Record<string, string> = {
  FRIO: '🧊',
  MORNO: '☀️',
  QUENTE: '🔥',
  URGENTE: '🚨',
};

export const statusColor: Record<string, string> = {
  NOVO: 'text-green-400 bg-green-400/10 border-green-400/30',
  EM_ATENDIMENTO: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  AGUARDANDO_CLIENTE: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  FECHADO: 'text-gray-500 bg-gray-500/10 border-gray-500/30',
  // legado
  ABERTA: 'text-green-400 bg-green-400/10 border-green-400/30',
  AGUARDANDO: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  FECHADA: 'text-gray-500 bg-gray-500/10 border-gray-500/30',
};

export const statusLabel: Record<string, string> = {
  NOVO: 'Novo',
  EM_ATENDIMENTO: 'Em Atendimento',
  AGUARDANDO_CLIENTE: 'Aguardando',
  FECHADO: 'Fechado',
};

export const modeLabel: Record<string, string> = {
  IA_AUTOMATICA:   'IA Auto',
  IA_ASSISTIDA:    'IA Assist.',
  HUMANO:          'Humano',
  AGUARDANDO_HUMANO: 'Aguard. Vendedor',
  PAUSADO:         'Pausado',
};

export const modeColor: Record<string, string> = {
  IA_AUTOMATICA:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  IA_ASSISTIDA:    'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  HUMANO:          'bg-green-500/15 text-green-400 border-green-500/30',
  AGUARDANDO_HUMANO: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  PAUSADO:         'bg-gray-500/15 text-gray-400 border-gray-500/30',
};
