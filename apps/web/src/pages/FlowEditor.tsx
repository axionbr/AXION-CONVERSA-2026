import { useCallback, useEffect, useState, useRef, DragEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactFlow, {
  Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState,
  Connection, NodeTypes, Panel, MarkerType, Handle, Position,
  ReactFlowProvider, useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save, Play, Pause, ArrowLeft, Plus, X, Settings, Zap,
  MessageSquare, HelpCircle, GitBranch, Bot, Tag, User, Store,
  Globe, Clock, Flag, Trash2, GripVertical,
} from 'lucide-react';
import { getFlow, updateFlow, toggleFlow } from '../lib/api';
import { cn } from '../lib/utils';

// ─── Node type definitions ────────────────────────────────────────────────────

const NODE_TYPES_DEF = [
  // ── Controle de fluxo ────────────────────────────────────────────────────────
  { type: 'START',           label: 'Início',             icon: Flag,         color: '#10b981', description: 'Ponto de entrada do fluxo' },
  { type: 'END',             label: 'Fim',                icon: Flag,         color: '#ef4444', description: 'Finaliza o fluxo' },
  { type: 'CONDITION',       label: 'Condição',           icon: GitBranch,    color: '#f59e0b', description: 'Ramifica baseado em regra' },
  { type: 'DELAY',           label: 'Aguardar',           icon: Clock,        color: '#94a3b8', description: 'Pausa antes do próximo nó' },
  // ── Mensagens ────────────────────────────────────────────────────────────────
  { type: 'MESSAGE',         label: 'Mensagem Fixa',      icon: MessageSquare,color: '#3b82f6', description: 'Envia mensagem de texto estática' },
  { type: 'QUESTION',        label: 'Pergunta',           icon: HelpCircle,   color: '#8b5cf6', description: 'Aguarda resposta do contato' },
  // ── Agentes Comerciais IA (têm prioridade sobre IA autônoma) ─────────────────
  { type: 'AGENT_SDR',       label: 'Agente SDR',         icon: Bot,          color: '#0ea5e9', description: 'Primeiro contato: recebe e entende intenção' },
  { type: 'AGENT_QUALIFIER', label: 'Agente Qualificador',icon: Bot,          color: '#f59e0b', description: 'Coleta cidade, interesse e perfil' },
  { type: 'AGENT_CONSULTANT',label: 'Agente Consultor',   icon: Bot,          color: '#10b981', description: 'Orienta consultivamente sobre o produto' },
  { type: 'AGENT_HANDOFF',   label: 'Agente Handoff',     icon: User,         color: '#ef4444', description: 'Transfere para vendedor humano' },
  { type: 'AI_RESPONSE',     label: 'IA Automática',      icon: Bot,          color: '#ec4899', description: 'Resposta IA com agente auto-detectado' },
  // ── Ações sobre lead/conversa ────────────────────────────────────────────────
  { type: 'SET_TAG',         label: 'Aplicar Tag',        icon: Tag,          color: '#06b6d4', description: 'Aplica uma tag ao lead' },
  { type: 'REMOVE_TAG',      label: 'Remover Tag',        icon: Tag,          color: '#64748b', description: 'Remove tag do lead' },
  { type: 'SET_FIELD',       label: 'Definir Campo',      icon: Settings,     color: '#f97316', description: 'Salva campo personalizado' },
  { type: 'ASSIGN_USER',     label: 'Transferir Humano',  icon: User,         color: '#3b82f6', description: 'Transfere para atendente específico' },
  { type: 'ASSIGN_STORE',    label: 'Atribuir Loja',      icon: Store,        color: '#10b981', description: 'Atribui a uma loja' },
  { type: 'PAUSE_AI',        label: 'Pausar IA',          icon: Pause,        color: '#f59e0b', description: 'Desativa a IA nesta conversa' },
  { type: 'RESUME_AI',       label: 'Ativar IA',          icon: Play,         color: '#10b981', description: 'Reativa a IA' },
  { type: 'WEBHOOK',         label: 'Webhook',            icon: Globe,        color: '#6366f1', description: 'Chama API externa' },
];

const typeMap = Object.fromEntries(NODE_TYPES_DEF.map(t => [t.type, t]));

// ─── Inputs estáveis para o painel de configuração ────────────────────────────
// IMPORTANTE: definidos FORA de qualquer componente para que a referência seja
// estável entre re-renders. Se fossem definidos dentro de NodeConfigPanel, React
// os desmontaria a cada tecla digitada, causando perda de foco.

interface ConfigFieldProps {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
  type?: string;
}
function ConfigField({ value, onChange, onBlur, placeholder, type = 'text' }: ConfigFieldProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border focus:border-primary outline-none"
    />
  );
}

interface ConfigAreaProps {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
}
function ConfigArea({ value, onChange, onBlur, placeholder }: ConfigAreaProps) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={3}
      className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border focus:border-primary outline-none resize-none"
    />
  );
}

// ─── Custom Node Component ─────────────────────────────────────────────────────

function FlowNode({ data, selected }: any) {
  const def = typeMap[data.type] || NODE_TYPES_DEF[0];
  const Icon = def.icon;
  const isStart = data.type === 'START';
  const isEnd   = data.type === 'END';

  return (
    <div
      className={cn(
        'min-w-[148px] rounded-xl border-2 bg-card shadow-xl transition-all select-none',
        selected ? 'shadow-lg' : 'border-border'
      )}
      style={{ borderColor: selected ? def.color : undefined }}
    >
      {/* Target handle (top) — all nodes except START */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3.5 !h-3.5 !border-2 !border-card !rounded-full !-top-[7px]"
          style={{ background: def.color }}
        />
      )}

      <div
        className="px-3 py-2 flex items-center gap-2 rounded-t-xl"
        style={{ background: def.color + '22' }}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: def.color }} />
        <span className="text-xs font-semibold" style={{ color: def.color }}>{def.label}</span>
      </div>

      <div className="px-3 py-2">
        <p className="text-xs font-medium truncate">{data.label || def.label}</p>
        {data.config?.text     && <p className="text-xs text-muted-foreground truncate mt-0.5">{data.config.text}</p>}
        {data.config?.tagName  && <p className="text-xs text-muted-foreground truncate mt-0.5">#{data.config.tagName}</p>}
        {data.config?.delay    && <p className="text-xs text-muted-foreground mt-0.5">{data.config.delay} {data.config.unit}</p>}
      </div>

      {/* Source handle (bottom) — all nodes except END */}
      {!isEnd && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3.5 !h-3.5 !border-2 !border-card !rounded-full !-bottom-[7px]"
          style={{ background: def.color }}
        />
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { custom: FlowNode };

// ─── Trigger labels ───────────────────────────────────────────────────────────

const TRIGGER_TYPES = [
  // ── Conversacionais (têm prioridade absoluta sobre IA autônoma) ──────────────
  { value: 'MESSAGE_RECEIVED',    label: '📩 Mensagem Recebida (prioridade)' },
  { value: 'FIRST_MESSAGE',       label: '👋 Primeira Mensagem (prioridade)' },
  { value: 'KEYWORD',             label: '🔑 Palavra-chave (prioridade)' },
  // ── Eventos de lead ───────────────────────────────────────────────────────────
  { value: 'LEAD_CREATED',        label: 'Lead Criado' },
  { value: 'LEAD_HOT',            label: '🔥 Lead Quente/Urgente' },
  { value: 'TEMPERATURE_CHANGED', label: 'Temperatura Alterada' },
  { value: 'TAG_APPLIED',         label: 'Tag Aplicada' },
  { value: 'STATUS_CHANGED',      label: 'Status Alterado' },
  { value: 'NO_RESPONSE',         label: 'Sem Resposta (+30min)' },
  { value: 'AFTER_HOURS',         label: 'Fora de Horário' },
];

// ─── Node config panel ────────────────────────────────────────────────────────
// Recebe `key={node.id}` do pai para remontar ao trocar de nó selecionado.
// Internamente usa estado local + salva apenas no onBlur para não perder foco.

function NodeConfigPanel({
  node, onUpdate, onDelete,
}: { node: any; onUpdate: (id: string, data: any) => void; onDelete: (id: string) => void }) {
  const [label, setLabel]   = useState(node.data.label || '');
  const [config, setConfig] = useState<any>(node.data.config || {});
  const def = typeMap[node.data.type];

  // Salva no componente pai apenas no onBlur (não a cada tecla)
  function save() {
    onUpdate(node.id, { ...node.data, label, config });
  }

  // Helpers locais — usam ConfigField/ConfigArea definidos fora (referências estáveis)
  const fieldProps = (field: string) => ({
    value:    config[field] || '',
    onChange: (v: string) => setConfig((c: any) => ({ ...c, [field]: v })),
    onBlur:   save,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {def && <def.icon className="w-4 h-4" style={{ color: def.color }} />}
          <span className="font-semibold text-sm">{def?.label || node.data.type}</span>
        </div>
        <button onClick={() => onDelete(node.id)} className="text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">Rótulo</label>
        <ConfigField
          value={label}
          onChange={setLabel}
          onBlur={save}
          placeholder="Nome do nó..."
        />
      </div>

      {node.data.type === 'MESSAGE' && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Mensagem</label>
          <ConfigArea {...fieldProps('text')} placeholder="Digite a mensagem..." />
        </div>
      )}

      {node.data.type === 'QUESTION' && (
        <>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Pergunta</label>
            <ConfigArea {...fieldProps('text')} placeholder="Digite a pergunta..." />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Salvar resposta no campo</label>
            <ConfigField {...fieldProps('saveToField')} placeholder="chave_do_campo" />
          </div>
        </>
      )}

      {node.data.type === 'CONDITION' && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Campo</label>
          <select
            value={config.field || ''}
            onChange={e => { setConfig((c: any) => ({ ...c, field: e.target.value })); save(); }}
            className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none"
          >
            <option value="">Selecione...</option>
            <option value="temperature">Temperatura</option>
            <option value="score">Score</option>
            <option value="status">Status</option>
          </select>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Operador</label>
              <select
                value={config.operator || ''}
                onChange={e => { setConfig((c: any) => ({ ...c, operator: e.target.value })); save(); }}
                className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none"
              >
                <option value="equals">Igual a</option>
                <option value="not_equals">Diferente de</option>
                <option value="contains">Contém</option>
                <option value="gt">Maior que</option>
                <option value="lt">Menor que</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Valor</label>
              <ConfigField {...fieldProps('value')} placeholder="Valor..." />
            </div>
          </div>
        </div>
      )}

      {(node.data.type === 'SET_TAG' || node.data.type === 'REMOVE_TAG') && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Nome da Tag</label>
          <ConfigField {...fieldProps('tagName')} placeholder="ex: VIP" />
        </div>
      )}

      {node.data.type === 'SET_FIELD' && (
        <>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Chave do Campo</label>
            <ConfigField {...fieldProps('fieldKey')} placeholder="ex: veiculo_interesse" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Valor</label>
            <ConfigField {...fieldProps('value')} placeholder="ex: Honda CG 160" />
          </div>
        </>
      )}

      {node.data.type === 'ASSIGN_USER' && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">ID do Usuário</label>
          <ConfigField {...fieldProps('userId')} placeholder="ID do atendente" />
        </div>
      )}

      {node.data.type === 'ASSIGN_STORE' && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">ID da Loja</label>
          <ConfigField {...fieldProps('storeId')} placeholder="ID da loja" />
        </div>
      )}

      {node.data.type === 'DELAY' && (
        <>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Tempo</label>
            <ConfigField {...fieldProps('delay')} type="number" placeholder="5" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Unidade</label>
            <select
              value={config.unit || 'minutes'}
              onChange={e => { setConfig((c: any) => ({ ...c, unit: e.target.value })); save(); }}
              className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none"
            >
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days">Dias</option>
            </select>
          </div>
        </>
      )}

      {node.data.type === 'WEBHOOK' && (
        <>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Método</label>
            <select
              value={config.method || 'POST'}
              onChange={e => { setConfig((c: any) => ({ ...c, method: e.target.value })); save(); }}
              className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none"
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">URL</label>
            <ConfigField {...fieldProps('url')} placeholder="https://..." />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Palette item (draggable) ─────────────────────────────────────────────────

function PaletteItem({
  def, onAddToCenter,
}: { def: typeof NODE_TYPES_DEF[0]; onAddToCenter: (type: string) => void }) {
  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('application/reactflow-type', def.type);
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={() => onAddToCenter(def.type)}
      title={def.description}
      className={cn(
        'group flex items-center gap-2 px-2.5 py-2 rounded-lg',
        'hover:bg-accent transition-colors cursor-grab active:cursor-grabbing select-none',
      )}
    >
      <GripVertical className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
      <def.icon className="w-3.5 h-3.5 shrink-0" style={{ color: def.color }} />
      <span className="text-xs font-medium">{def.label}</span>
    </div>
  );
}

// ─── Inner canvas (uses useReactFlow) ────────────────────────────────────────

function FlowEditorCanvas() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { screenToFlowPosition, getViewport } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode]   = useState<any>(null);
  const [sidebarTab, setSidebarTab]       = useState<'nodes' | 'triggers' | 'config'>('nodes');
  const [triggers, setTriggers]           = useState<any[]>([]);
  const [flowName, setFlowName]           = useState('');
  const [flowDesc, setFlowDesc]           = useState('');
  const [saved, setSaved]                 = useState(false);
  const [isDragOver, setIsDragOver]       = useState(false);

  const { data: flow } = useQuery({
    queryKey: ['flow', id],
    queryFn: () => getFlow(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (!flow) return;
    setFlowName(flow.name);
    setFlowDesc(flow.description || '');
    setTriggers(flow.triggers || []);

    setNodes(flow.nodes.map((n: any) => ({
      id: n.id,
      type: 'custom',
      position: { x: n.positionX, y: n.positionY },
      data: { type: n.type, label: n.title || typeMap[n.type]?.label, config: n.config || {} },
    })));

    setEdges(flow.edges.map((e: any) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      style: { stroke: '#3b82f6', strokeWidth: 2 },
    })));
  }, [flow]);

  // ── mutations ──────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: (data: any) => updateFlow(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow', id] });
      qc.invalidateQueries({ queryKey: ['flows'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const toggleMut = useMutation({
    mutationFn: () => toggleFlow(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flow', id] }),
    onError: (err: any) => alert(err.response?.data?.error || 'Erro'),
  });

  // ── edge connect ───────────────────────────────────────────────────────────

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges(es =>
        addEdge({
          ...params,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
          style: { stroke: '#3b82f6', strokeWidth: 2 },
        }, es)
      ),
    [setEdges],
  );

  // ── node helpers ───────────────────────────────────────────────────────────

  function spawnNode(type: string, position: { x: number; y: number }) {
    const def   = typeMap[type];
    const nid   = `node-${Date.now()}`;
    setNodes(ns => [
      ...ns,
      {
        id: nid,
        type: 'custom',
        position,
        data: { type, label: def?.label || type, config: {} },
      },
    ]);
  }

  /** Click on palette → place at visible center of the canvas */
  function addNodeToCenter(type: string) {
    const vp = getViewport();
    const el = canvasRef.current;
    if (!el) { spawnNode(type, { x: 300, y: 200 }); return; }
    const { width, height } = el.getBoundingClientRect();
    const position = screenToFlowPosition({
      x: el.getBoundingClientRect().left + width  / 2,
      y: el.getBoundingClientRect().top  + height / 2,
    });
    spawnNode(type, position);
  }

  function updateNodeData(nodeId: string, data: any) {
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, data } : n));
    setSelectedNode((prev: any) => prev?.id === nodeId ? { ...prev, data } : prev);
  }

  function deleteNode(nodeId: string) {
    setNodes(ns => ns.filter(n => n.id !== nodeId));
    setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }

  // ── drag & drop from palette ───────────────────────────────────────────────

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('application/reactflow-type')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    // only clear when truly leaving the canvas (not entering a child)
    if (canvasRef.current?.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const type = e.dataTransfer.getData('application/reactflow-type');
    if (!type) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    spawnNode(type, position);
  }

  // ── save ───────────────────────────────────────────────────────────────────

  function handleSave() {
    saveMut.mutate({
      name:        flowName,
      description: flowDesc,
      nodes: nodes.map(n => ({
        id:        n.id,
        type:      n.data.type,
        title:     n.data.label,
        config:    n.data.config || {},
        positionX: n.position.x,
        positionY: n.position.y,
      })),
      edges: edges.map(e => ({
        id:           e.id,
        sourceNodeId: e.source,
        targetNodeId: e.target,
        label:        e.label,
      })),
      triggers,
    });
  }

  // ── trigger helpers ────────────────────────────────────────────────────────

  const addTrigger    = () => setTriggers(t => [...t, { type: 'KEYWORD', value: '', active: true }]);
  const updateTrigger = (i: number, data: any) => setTriggers(t => t.map((item, idx) => idx === i ? { ...item, ...data } : item));
  const removeTrigger = (i: number)            => setTriggers(t => t.filter((_, idx) => idx !== i));

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-background">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/flows')} className="text-muted-foreground hover:text-foreground p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <input
            value={flowName}
            onChange={e => setFlowName(e.target.value)}
            className="bg-transparent font-semibold text-sm outline-none border-b border-transparent focus:border-primary transition-colors min-w-0 w-48"
          />
        </div>

        <div className="flex items-center gap-2">
          {saved && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-green-400"
            >
              Salvo ✓
            </motion.span>
          )}
          <button
            onClick={() => toggleMut.mutate()}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              flow?.active
                ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {flow?.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {flow?.active ? 'Desativar' : 'Ativar'}
          </button>
          <button
            onClick={handleSave}
            disabled={saveMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            <Save className="w-3.5 h-3.5" />
            Salvar
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left panel (palette) ── */}
        <div className="w-56 shrink-0 border-r border-border bg-card/30 flex flex-col">
          <div className="flex border-b border-border">
            {(['nodes', 'triggers', 'config'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSidebarTab(tab)}
                className={cn(
                  'flex-1 py-2 text-xs font-medium transition-colors',
                  sidebarTab === tab
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab === 'nodes' ? 'Nós' : tab === 'triggers' ? 'Gatilhos' : 'Config'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2">

            {/* ─ Nodes tab ─ */}
            {sidebarTab === 'nodes' && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-wide font-medium">
                  Arraste para o canvas
                </p>
                {NODE_TYPES_DEF.map(def => (
                  <PaletteItem key={def.type} def={def} onAddToCenter={addNodeToCenter} />
                ))}
              </div>
            )}

            {/* ─ Triggers tab ─ */}
            {sidebarTab === 'triggers' && (
              <div className="space-y-2">
                {triggers.map((t, i) => (
                  <div key={i} className="glass rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Gatilho {i + 1}</span>
                      <button onClick={() => removeTrigger(i)} className="text-muted-foreground hover:text-destructive">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <select
                      value={t.type}
                      onChange={e => updateTrigger(i, { type: e.target.value })}
                      className="w-full bg-input text-xs px-2 py-1.5 rounded border border-border outline-none"
                    >
                      {TRIGGER_TYPES.map(tt => (
                        <option key={tt.value} value={tt.value}>{tt.label}</option>
                      ))}
                    </select>
                    {(t.type === 'KEYWORD' || t.type === 'TAG_APPLIED' || t.type === 'STATUS_CHANGED') && (
                      <input
                        value={t.value || ''}
                        onChange={e => updateTrigger(i, { value: e.target.value })}
                        placeholder={t.type === 'KEYWORD' ? 'Palavra-chave...' : 'Valor...'}
                        className="w-full bg-input text-xs px-2 py-1.5 rounded border border-border outline-none"
                      />
                    )}
                  </div>
                ))}
                <button
                  onClick={addTrigger}
                  className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Gatilho
                </button>
              </div>
            )}

            {/* ─ Config tab ─ */}
            {sidebarTab === 'config' && (
              <div className="space-y-3 p-1">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nome</label>
                  <input
                    value={flowName}
                    onChange={e => setFlowName(e.target.value)}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Descrição</label>
                  <textarea
                    value={flowDesc}
                    onChange={e => setFlowDesc(e.target.value)}
                    rows={3}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary resize-none"
                  />
                </div>
                <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
                  <p>Nós: {nodes.length}</p>
                  <p>Conexões: {edges.length}</p>
                  <p>
                    Status:{' '}
                    <span className={flow?.active ? 'text-green-400' : 'text-muted-foreground'}>
                      {flow?.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Canvas ── */}
        <div
          ref={canvasRef}
          className={cn(
            'flex-1 relative transition-colors duration-150',
            isDragOver && 'ring-2 ring-inset ring-primary/40 bg-primary/5',
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {/* drop hint overlay */}
          <AnimatePresence>
            {isDragOver && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
              >
                <div className="bg-card/90 border-2 border-dashed border-primary/60 rounded-2xl px-8 py-4 text-sm font-medium text-primary">
                  Solte para adicionar o nó
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => {
              setSelectedNode(node);
              setSidebarTab('nodes');
            }}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            deleteKeyCode="Delete"
            className="bg-background"
            connectionLineStyle={{ stroke: '#3b82f6', strokeWidth: 2 }}
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
              style: { stroke: '#3b82f6', strokeWidth: 2 },
            }}
          >
            <Background color="#1e293b" gap={24} size={1} />
            <Controls className="bg-card border border-border" />
            <MiniMap className="bg-card border border-border" nodeColor={() => '#3b82f6'} />
            <Panel position="top-center">
              <div className="text-xs text-muted-foreground bg-card/80 backdrop-blur px-3 py-1.5 rounded-full border border-border">
                Arraste da paleta • Conecte as portas • Delete para remover
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* ── Right panel: node config ── */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 244, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 border-l border-border bg-card/30 overflow-hidden"
            >
              <div className="w-[244px] h-full flex flex-col">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Configurar Nó
                  </span>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {/* key={selectedNode.id} garante que o estado local do painel
                      é resetado ao trocar de nó, sem afetar o foco durante digitação */}
                  <NodeConfigPanel
                    key={selectedNode.id}
                    node={selectedNode}
                    onUpdate={updateNodeData}
                    onDelete={deleteNode}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Export (wrapped in ReactFlowProvider) ────────────────────────────────────

export default function FlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowEditorCanvas />
    </ReactFlowProvider>
  );
}
