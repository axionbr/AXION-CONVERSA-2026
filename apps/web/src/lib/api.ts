import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password }).then(r => r.data);
export const getMe = () => api.get('/auth/me').then(r => r.data);

// Dashboard
export const getDashboardMetrics = () => api.get('/dashboard/metrics').then(r => r.data);
export const getLiveConversations = (params?: any) => api.get('/dashboard/live-conversations', { params }).then(r => r.data);
export const getAutomationLogs = () => api.get('/dashboard/automation-logs').then(r => r.data);

// Conversations
export const getConversations = (params?: any) => api.get('/conversations', { params }).then(r => r.data);
export const getConversation = (id: string) => api.get(`/conversations/${id}`).then(r => r.data);
export const getConversationMessages = (id: string) => api.get(`/conversations/${id}/messages`).then(r => r.data);
export const sendMessage = (id: string, content: string) => api.post(`/conversations/${id}/send`, { content }).then(r => r.data);
export const assumeConversation = (id: string) => api.post(`/conversations/${id}/assume`).then(r => r.data);
export const pauseAI = (id: string) => api.post(`/conversations/${id}/pause-ai`).then(r => r.data);
export const resumeAI = (id: string) => api.post(`/conversations/${id}/resume-ai`).then(r => r.data);
export const transferConversation = (id: string, userId: string) => api.post(`/conversations/${id}/transfer`, { userId }).then(r => r.data);
export const updateConversationStatus = (id: string, status: string) => api.put(`/conversations/${id}/status`, { status }).then(r => r.data);

// Leads
export const getLeads = (params?: any) => api.get('/leads', { params }).then(r => r.data);
export const getLead = (id: string) => api.get(`/leads/${id}`).then(r => r.data);
export const createLead = (data: any) => api.post('/leads', data).then(r => r.data);
export const updateLead = (id: string, data: any) => api.put(`/leads/${id}`, data).then(r => r.data);

// Contacts
export const getContacts = (params?: any) => api.get('/contacts', { params }).then(r => r.data);
export const getContact = (id: string) => api.get(`/contacts/${id}`).then(r => r.data);

// Users
export const getUsers = (params?: any) => api.get('/users', { params }).then(r => r.data);
export const createUser = (data: any) => api.post('/users', data).then(r => r.data);
export const updateUser = (id: string, data: any) => api.put(`/users/${id}`, data).then(r => r.data);

// Stores
export const getStores = () => api.get('/stores').then(r => r.data);
export const createStore = (data: any) => api.post('/stores', data).then(r => r.data);

// Tags
export const getTags = () => api.get('/tags').then(r => r.data);
export const createTag = (data: any) => api.post('/tags', data).then(r => r.data);

// Custom Fields
export const getCustomFields = () => api.get('/custom-fields').then(r => r.data);
export const createCustomField = (data: any) => api.post('/custom-fields', data).then(r => r.data);

// Flows
export const getFlows = () => api.get('/flows').then(r => r.data);
export const getFlow = (id: string) => api.get(`/flows/${id}`).then(r => r.data);
export const createFlow = (data?: any) => api.post('/flows', data || {}).then(r => r.data);
export const updateFlow = (id: string, data: any) => api.put(`/flows/${id}`, data).then(r => r.data);
export const toggleFlow = (id: string) => api.post(`/flows/${id}/toggle`).then(r => r.data);
export const duplicateFlow = (id: string) => api.post(`/flows/${id}/duplicate`).then(r => r.data);
export const deleteFlow = (id: string) => api.delete(`/flows/${id}`).then(r => r.data);
export const triggerFlow = (id: string, conversationId: string, leadId?: string) =>
  api.post(`/flows/${id}/trigger`, { conversationId, leadId }).then(r => r.data);
export const getFlowExecutions = (id: string) => api.get(`/flows/${id}/executions`).then(r => r.data);

// AI
export const testAI = (message: string, storeId?: string) =>
  api.post('/ai/test', { message, storeId }).then(r => r.data);
export const getAiConfigs = () => api.get('/ai/config').then(r => r.data);
export const saveAiConfig = (data: any) => api.post('/ai/config', data).then(r => r.data);

// Z-API
export const getZapiConfigs = () => api.get('/zapi/config').then(r => r.data);
export const saveZapiConfig = (data: any) => api.post('/zapi/config', data).then(r => r.data);
export const getZapiStatus = (storeId?: string) => api.get('/zapi/status', { params: { storeId } }).then(r => r.data);
