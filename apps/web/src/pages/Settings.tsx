import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Bot, Zap, Save, TestTube2, Loader2 } from 'lucide-react';
import {
  getAiConfigs, saveAiConfig, getZapiConfigs, saveZapiConfig,
  getZapiStatus, testAI, getStores,
} from '../lib/api';

export default function Settings() {
  const [tab, setTab] = useState<'ai' | 'zapi' | 'stores'>('ai');

  const { data: aiConfigs = [] } = useQuery({ queryKey: ['ai-configs'], queryFn: getAiConfigs });
  const { data: zapiConfigs = [] } = useQuery({ queryKey: ['zapi-configs'], queryFn: getZapiConfigs });
  const { data: stores = [] } = useQuery({ queryKey: ['stores'], queryFn: getStores });

  // AI Config state
  const [aiForm, setAiForm] = useState({ provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 500, systemPrompt: '', storeId: '' });
  const [testMsg, setTestMsg] = useState('Olá, quero saber sobre motos');
  const [testResult, setTestResult] = useState('');

  const aiMut = useMutation({ mutationFn: () => saveAiConfig(aiForm) });
  const testMut = useMutation({
    mutationFn: () => testAI(testMsg),
    onSuccess: (data) => setTestResult(data.reply),
  });

  // Z-API Config state
  const [zapiForm, setZapiForm] = useState({ instanceId: '', token: '', clientToken: '', baseUrl: 'https://api.z-api.io', storeId: '' });
  const [zapiStatus, setZapiStatus] = useState<any>(null);
  const zapiMut = useMutation({ mutationFn: () => saveZapiConfig(zapiForm) });
  const statusMut = useMutation({
    mutationFn: () => getZapiStatus(),
    onSuccess: (data) => setZapiStatus(data),
    onError: () => setZapiStatus({ connected: false, error: 'Não conectado' }),
  });

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border bg-card/50">
        <h1 className="text-lg font-bold">Configurações</h1>
        <p className="text-xs text-muted-foreground">IA, Z-API e integrações</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-6">
        {[
          { key: 'ai', label: 'Inteligência Artificial', icon: Bot },
          { key: 'zapi', label: 'Z-API WhatsApp', icon: Zap },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'ai' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl space-y-6">
            <div className="glass rounded-xl p-6 space-y-4">
              <h2 className="font-semibold">Configuração da IA</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Provider</label>
                  <select
                    value={aiForm.provider}
                    onChange={e => setAiForm(f => ({ ...f, provider: e.target.value }))}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                  >
                    <option value="openai">OpenAI (GPT)</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Modelo</label>
                  <input
                    value={aiForm.model}
                    onChange={e => setAiForm(f => ({ ...f, model: e.target.value }))}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                    placeholder="gpt-4o-mini"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Temperatura (0–1)</label>
                  <input
                    type="number" min="0" max="1" step="0.1"
                    value={aiForm.temperature}
                    onChange={e => setAiForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Máx. Tokens</label>
                  <input
                    type="number"
                    value={aiForm.maxTokens}
                    onChange={e => setAiForm(f => ({ ...f, maxTokens: parseInt(e.target.value) }))}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Prompt do Sistema</label>
                <textarea
                  value={aiForm.systemPrompt}
                  onChange={e => setAiForm(f => ({ ...f, systemPrompt: e.target.value }))}
                  rows={4}
                  placeholder="Você é um atendente especializado em..."
                  className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary resize-none"
                />
              </div>

              <button
                onClick={() => aiMut.mutate()}
                disabled={aiMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                {aiMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
              {aiMut.isSuccess && <p className="text-sm text-green-400">Configuração salva!</p>}
            </div>

            {/* Test AI */}
            <div className="glass rounded-xl p-6 space-y-4">
              <h2 className="font-semibold flex items-center gap-2">
                <TestTube2 className="w-4 h-4 text-primary" />
                Testar IA
              </h2>
              <textarea
                value={testMsg}
                onChange={e => setTestMsg(e.target.value)}
                rows={2}
                className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary resize-none"
              />
              <button
                onClick={() => testMut.mutate()}
                disabled={testMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-secondary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                Testar
              </button>
              {testResult && (
                <div className="bg-muted rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Resposta da IA:</p>
                  <p className="text-sm">{testResult}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {tab === 'zapi' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl space-y-6">
            <div className="glass rounded-xl p-6 space-y-4">
              <h2 className="font-semibold">Configuração Z-API</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Instance ID</label>
                  <input
                    value={zapiForm.instanceId}
                    onChange={e => setZapiForm(f => ({ ...f, instanceId: e.target.value }))}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                    placeholder="sua-instancia"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Token</label>
                  <input
                    type="password"
                    value={zapiForm.token}
                    onChange={e => setZapiForm(f => ({ ...f, token: e.target.value }))}
                    className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Client Token (opcional)</label>
                <input
                  type="password"
                  value={zapiForm.clientToken}
                  onChange={e => setZapiForm(f => ({ ...f, clientToken: e.target.value }))}
                  className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">URL Base</label>
                <input
                  value={zapiForm.baseUrl}
                  onChange={e => setZapiForm(f => ({ ...f, baseUrl: e.target.value }))}
                  className="w-full bg-input text-sm px-3 py-2 rounded-lg border border-border outline-none focus:border-primary"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => zapiMut.mutate()}
                  disabled={zapiMut.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {zapiMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar
                </button>
                <button
                  onClick={() => statusMut.mutate()}
                  disabled={statusMut.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-accent disabled:opacity-60"
                >
                  {statusMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Testar Conexão
                </button>
              </div>

              {zapiStatus && (
                <div className={`rounded-lg p-3 text-sm ${zapiStatus.connected ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                  {zapiStatus.connected ? '✓ Conectado ao WhatsApp' : `✗ ${zapiStatus.error || 'Não conectado'}`}
                </div>
              )}

              <div className="bg-muted rounded-lg p-3">
                <p className="text-xs text-muted-foreground font-medium mb-1">Configuração do Webhook</p>
                <code className="text-xs text-primary">POST {window.location.origin}/api/webhooks/zapi</code>
                <p className="text-xs text-muted-foreground mt-1">Header: <code>x-webhook-secret: &lt;WEBHOOK_SECRET&gt;</code></p>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
