export type Role = 'ADMIN' | 'DIRETOR' | 'GERENTE' | 'ATENDENTE' | 'VENDEDOR';
export type Temperature = 'FRIO' | 'MORNO' | 'QUENTE' | 'URGENTE';
export type LeadStatus = 'NOVO' | 'EM_CONTATO' | 'QUALIFICADO' | 'PROPOSTA' | 'FECHADO' | 'PERDIDO';
export type ConversationStatus = 'ABERTA' | 'EM_ATENDIMENTO' | 'AGUARDANDO' | 'RESOLVIDA' | 'FECHADA';
export type ConversationMode = 'IA_AUTOMATICA' | 'IA_ASSISTIDA' | 'HUMANO';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION' | 'CONTACT';
export type AiProvider = 'openai' | 'anthropic';

export type FlowNodeType =
  | 'START' | 'END' | 'MESSAGE' | 'QUESTION' | 'CONDITION'
  | 'AI_RESPONSE' | 'SET_TAG' | 'REMOVE_TAG' | 'SET_FIELD'
  | 'ASSIGN_USER' | 'ASSIGN_STORE' | 'PAUSE_AI' | 'RESUME_AI'
  | 'WEBHOOK' | 'DELAY';

export type FlowTriggerType =
  | 'FIRST_MESSAGE' | 'KEYWORD' | 'TAG_APPLIED' | 'TEMPERATURE_CHANGED'
  | 'LEAD_CREATED' | 'STATUS_CHANGED' | 'NO_RESPONSE' | 'AFTER_HOURS'
  | 'CAMPAIGN_STARTED' | 'EXTERNAL_WEBHOOK';

export type FlowExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED';

export interface SocketEvents {
  'conversation:new': { conversationId: string };
  'conversation:updated': { conversationId: string };
  'message:new': { conversationId: string; message: MessagePayload };
  'lead:updated': { leadId: string };
  'flow:execution': { executionId: string; status: string };
}

export interface MessagePayload {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  createdAt: string;
  fromFlow?: boolean;
}

export interface DashboardMetrics {
  totalConversations: number;
  activeConversations: number;
  awaitingHuman: number;
  resolvedToday: number;
  newLeadsToday: number;
  hotLeads: number;
  avgResponseTime: number;
  aiHandled: number;
}
