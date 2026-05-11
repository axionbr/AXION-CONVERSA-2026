import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { getDashboardCharts } from '../lib/api';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart2, PieChart as PieIcon, TrendingUp, ArrowDownUp } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  NOVO: 'Novo',
  EM_ATENDIMENTO: 'Em Atendimento',
  AGUARDANDO: 'Aguardando',
  AGUARDANDO_CLIENTE: 'Ag. Cliente',
  RESOLVIDA: 'Resolvida',
  FECHADO: 'Fechado',
  ABERTA: 'Ativa',
};

const STATUS_COLORS: Record<string, string> = {
  NOVO: '#60A5FA',
  EM_ATENDIMENTO: '#F97316',
  AGUARDANDO: '#FBBF24',
  AGUARDANDO_CLIENTE: '#FBBF24',
  RESOLVIDA: '#34D399',
  FECHADO: '#6B7280',
  ABERTA: '#A78BFA',
};

const TEMP_COLORS: Record<string, string> = {
  FRIO: '#60A5FA',
  MORNO: '#FBBF24',
  QUENTE: '#F97316',
  URGENTE: '#EF4444',
};

const TEMP_LABELS: Record<string, string> = {
  FRIO: 'Frio',
  MORNO: 'Morno',
  QUENTE: 'Quente',
  URGENTE: 'Urgente',
};

const CHART_CARD = 'rounded-xl border border-[#343434] bg-[#2a2a2a] p-4';
const CHART_TITLE = 'text-sm font-semibold text-[#f5f5f5] mb-4 flex items-center gap-2';
const TICK_STYLE = { fill: '#b3b3b3', fontSize: 11 };

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#343434] bg-[#2a2a2a] px-3 py-2 text-xs shadow-lg">
      {label && <p className="text-[#b3b3b3] mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || p.fill || '#F97316' }}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function CustomPieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-[#343434] bg-[#2a2a2a] px-3 py-2 text-xs shadow-lg">
      <p style={{ color: item.payload.fill }}>
        {STATUS_LABELS[item.name] || item.name}: <span className="font-bold">{item.value}</span>
      </p>
    </div>
  );
}

function formatDayLabel(date: string, period: string) {
  if (period === 'today') return date;
  try {
    return format(parseISO(date), period === '30d' || period === 'month' ? 'dd/MM' : 'dd/MMM', { locale: ptBR });
  } catch {
    return date;
  }
}

function SkeletonChart() {
  return (
    <div className="h-[200px] flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-[#F97316] border-t-transparent animate-spin" />
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-[200px] flex items-center justify-center text-[#b3b3b3] text-xs">
      Sem dados para o período
    </div>
  );
}

export default function DashboardCharts({ period }: { period: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-charts', period],
    queryFn: () => getDashboardCharts(period),
    refetchInterval: 30_000,
  });

  const convData = data?.conversationsByDay?.map((d: any) => ({
    ...d,
    label: formatDayLabel(d.date, period),
  })) ?? [];

  const statusData = (data?.statusDistribution ?? []).map((d: any) => ({
    ...d,
    label: STATUS_LABELS[d.status] || d.status,
    fill: STATUS_COLORS[d.status] || '#6B7280',
  }));

  const tempData = (data?.leadTemperature ?? []).map((d: any) => ({
    ...d,
    label: TEMP_LABELS[d.temperature] || d.temperature,
    fill: TEMP_COLORS[d.temperature] || '#6B7280',
  }));

  const msgData = data?.messagesByDirection
    ? [
        { name: 'Recebidas', value: data.messagesByDirection.inbound, fill: '#F97316' },
        { name: 'Enviadas', value: data.messagesByDirection.outbound, fill: '#60A5FA' },
      ]
    : [];

  const hasConvData = convData.some((d: any) => d.count > 0);
  const hasStatusData = statusData.some((d: any) => d.count > 0);
  const hasTempData = tempData.some((d: any) => d.count > 0);
  const hasMsgData = msgData.some((d: any) => d.value > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Conversas por período */}
      <div className={CHART_CARD}>
        <p className={CHART_TITLE}>
          <BarChart2 className="w-4 h-4 text-[#F97316]" />
          Conversas recebidas
        </p>
        {isLoading ? (
          <SkeletonChart />
        ) : !hasConvData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            {period === 'today' ? (
              <BarChart data={convData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#343434" />
                <XAxis dataKey="label" tick={TICK_STYLE} />
                <YAxis allowDecimals={false} tick={TICK_STYLE} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Conversas" fill="#F97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={convData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#343434" />
                <XAxis dataKey="label" tick={TICK_STYLE} />
                <YAxis allowDecimals={false} tick={TICK_STYLE} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Conversas"
                  stroke="#F97316"
                  strokeWidth={2}
                  dot={{ fill: '#F97316', r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* Status das conversas */}
      <div className={CHART_CARD}>
        <p className={CHART_TITLE}>
          <PieIcon className="w-4 h-4 text-[#F97316]" />
          Status das conversas
        </p>
        {isLoading ? (
          <SkeletonChart />
        ) : !hasStatusData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="count"
                nameKey="status"
              >
                {statusData.map((entry: any, i: number) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<CustomPieTooltip />} />
              <Legend
                formatter={(value) => (
                  <span className="text-[#b3b3b3] text-xs">{STATUS_LABELS[value] || value}</span>
                )}
                iconSize={8}
                iconType="circle"
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Qualificação dos leads */}
      <div className={CHART_CARD}>
        <p className={CHART_TITLE}>
          <TrendingUp className="w-4 h-4 text-[#F97316]" />
          Qualificação dos leads
        </p>
        {isLoading ? (
          <SkeletonChart />
        ) : !hasTempData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={tempData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#343434" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={TICK_STYLE} />
              <YAxis type="category" dataKey="label" tick={TICK_STYLE} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" name="Leads" radius={[0, 4, 4, 0]}>
                {tempData.map((entry: any, i: number) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recebidas x Enviadas */}
      <div className={CHART_CARD}>
        <p className={CHART_TITLE}>
          <ArrowDownUp className="w-4 h-4 text-[#F97316]" />
          Recebidas x Enviadas
        </p>
        {isLoading ? (
          <SkeletonChart />
        ) : !hasMsgData ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={msgData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#343434" />
              <XAxis dataKey="name" tick={TICK_STYLE} />
              <YAxis allowDecimals={false} tick={TICK_STYLE} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Mensagens" radius={[4, 4, 0, 0]}>
                {msgData.map((entry: any, i: number) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
