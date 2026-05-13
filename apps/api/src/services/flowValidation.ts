// ─── Flow Validation Service ──────────────────────────────────────────────────
// Valida um fluxo antes de ativar ou executar.

export interface FlowValidationError {
  nodeId?: string;
  type:    'ERROR' | 'WARNING';
  message: string;
}

export interface FlowValidationResult {
  valid:    boolean;
  errors:   FlowValidationError[];
  warnings: FlowValidationError[];
}

interface NodeLike  { id: string; type: string; title?: string | null; config: any }
interface EdgeLike  { id: string; sourceNodeId: string; targetNodeId: string }

function parseConfig(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw as Record<string, any>;
}

export function validateFlow(
  nodes: NodeLike[],
  edges: EdgeLike[],
): FlowValidationResult {
  const errors:   FlowValidationError[] = [];
  const warnings: FlowValidationError[] = [];

  const nodeIds   = new Set(nodes.map(n => n.id));
  const startNodes = nodes.filter(n => n.type === 'START');
  const endNodes   = nodes.filter(n => n.type === 'END');

  // ── Estrutura global ─────────────────────────────────────────────────────────
  if (startNodes.length === 0) {
    errors.push({ type: 'ERROR', message: 'O fluxo precisa ter um nó de INÍCIO (START).' });
  }
  if (startNodes.length > 1) {
    errors.push({ type: 'ERROR', message: 'O fluxo não pode ter mais de um INÍCIO.' });
  }
  if (endNodes.length === 0) {
    errors.push({ type: 'ERROR', message: 'O fluxo precisa ter um nó de FIM (END).' });
  }
  if (nodes.length === 0) {
    errors.push({ type: 'ERROR', message: 'O fluxo não tem nenhum nó.' });
    return { valid: false, errors, warnings };
  }
  if (edges.length === 0 && nodes.length > 1) {
    errors.push({ type: 'ERROR', message: 'O fluxo tem nós sem nenhuma conexão.' });
  }

  // ── START conectado ───────────────────────────────────────────────────────────
  for (const start of startNodes) {
    const hasOut = edges.some(e => e.sourceNodeId === start.id);
    if (!hasOut) {
      errors.push({ nodeId: start.id, type: 'ERROR', message: 'INÍCIO precisa estar conectado a pelo menos um nó.' });
    }
  }

  // ── Validações por nó ─────────────────────────────────────────────────────────
  for (const node of nodes) {
    const cfg   = parseConfig(node.config);
    const label = node.title || node.type;

    if (node.type === 'MESSAGE') {
      if (!cfg.text?.trim()) {
        errors.push({ nodeId: node.id, type: 'ERROR', message: `Nó "Mensagem" (${label}) precisa ter texto.` });
      }
    }

    if (node.type === 'QUESTION') {
      if (!cfg.text?.trim()) {
        errors.push({ nodeId: node.id, type: 'ERROR', message: `Nó "Pergunta" (${label}) precisa ter texto da pergunta.` });
      }
    }

    if (node.type === 'CONDITION') {
      if (!cfg.field) {
        errors.push({ nodeId: node.id, type: 'ERROR', message: `Nó "Condição" (${label}) precisa ter um campo configurado.` });
      }
      if (!cfg.operator) {
        errors.push({ nodeId: node.id, type: 'ERROR', message: `Nó "Condição" (${label}) precisa ter um operador.` });
      }
    }

    if (node.type === 'WEBHOOK') {
      if (!cfg.url?.trim()) {
        errors.push({ nodeId: node.id, type: 'ERROR', message: `Nó "Webhook" (${label}) precisa ter URL.` });
      }
    }

    // Nó solto (sem saída) — exceto END
    if (!['END', 'AGENT_HANDOFF', 'PAUSE_AI'].includes(node.type)) {
      const hasOut = edges.some(e => e.sourceNodeId === node.id);
      if (!hasOut) {
        warnings.push({ nodeId: node.id, type: 'WARNING', message: `Nó "${label}" não tem conexão de saída — o fluxo pode travar aqui.` });
      }
    }

    // Nó sem entrada — exceto START
    if (node.type !== 'START') {
      const hasIn = edges.some(e => e.targetNodeId === node.id);
      if (!hasIn) {
        warnings.push({ nodeId: node.id, type: 'WARNING', message: `Nó "${label}" não tem conexão de entrada — nunca será executado.` });
      }
    }
  }

  // ── Edges inválidas ───────────────────────────────────────────────────────────
  for (const edge of edges) {
    if (!nodeIds.has(edge.targetNodeId)) {
      errors.push({ type: 'ERROR', message: `Conexão aponta para nó inexistente (${edge.targetNodeId}).` });
    }
    if (!nodeIds.has(edge.sourceNodeId)) {
      errors.push({ type: 'ERROR', message: `Conexão parte de nó inexistente (${edge.sourceNodeId}).` });
    }
  }

  return {
    valid:    errors.length === 0,
    errors,
    warnings,
  };
}
