import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Bot, Zap, Save, TestTube2, Loader2,
  CheckCircle, XCircle, ExternalLink, Plug,
} from 'lucide-react';
import {
  getAiConfigs, saveAiConfig, getZapiConfigs, saveZapiConfig,
  getZapiStatus, testAI, getIntegrations,
} from '../lib/api';
import { cn } from '../lib/utils';

type Tab = 'ai' | 'zapi' | 'integrations';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'ai',           label: 'Inteligencia Artificial', icon: Bot  },
  { key: 'zapi',         label: 'Z-API WhatsApp',          icon: Zap  },
  { key: 'integrations', label: 'Integracoes',             icon: Plug },
];

const INTEGRATION_ICONS: Record<string, string> = {
  claude: '🧠',
  zapi:   '📱',
};

const CLAUDE_MODEL_SUGGESTIONS = [
  'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-latest',
  'claude-sonnet-4-6',
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('ai');

  const { data: aiConfigs = [] } = useQuery({ queryKey: ['ai-configs'], queryFn: getAiConfigs });
  const { data: zapiConfigs = [] } = useQuery({ queryKey: ['zapi-configs'], queryFn: getZapiConfigs });

  const { data: integrations, isLoading: loadingIntegrations } = useQuery({
    queryKey: ['integrations'],
    queryFn:  getIntegrations,
    enabled:  tab === 'integrations',
  });

  // ─── Formulário IA — sempre Anthropic ────────────────────────────────────────
  const [aiForm, setAiForm] = useState({
    provider:     'anthropic',
    model:        'claude-haiku-4-5-20251001',
    temperature:  0.7,
    maxTokens:    500,
    systemPrompt: '',
    storeId:      '',
  });
  const [testMsg,    setTestMsg]    = useState('Ola, quero saber sobre motos');
  const [testResult, setTestResult] = useState('');

  // Popula o form com o que está salvo no banco (config global sem storeId)
  useEffect(() => {
    if (!aiConfigs.length) return;
    const global = (aiConfigs as any[]).find((c: any) => !c.storeId) ?? aiConfigs[0];
    if (!global) return;
    // Garantir que o modelo salvo seja Claude; se for GPT, substituir pelo default
    const savedModel = (global.model as string) || '';
    const effectiveModel = savedModel.startsWith('claude-')
      ? savedModel
      : 'claude-haiku-4-5-20251001';
    setAiForm(f => ({
      ...f,
      provider:     'anthropic',
      model:        effectiveModel,
      temperature:  global.temperature  ?? 0.7,
      maxTokens:    global.maxTokens    ?? 500,
      systemPrompt: global.systemPrompt ?? '',
      storeId:      global.storeId      ?? '',
    }));
  }, [aiConfigs]);

  const aiMut  = useMutation({ mutationFn: () => saveAiConfig({ ...aiForm, provider: 'anthropic' }) });
  const testMut = useMutation({
    mutationFn: () => testAI(testMsg),
    onSuccess:  (data) => setTestResult(data.reply),
  });

  // ─── Formulário Z-API ─────────────────────────────────────────────────────
  const [zapiForm, setZapiForm] = useState({
    instanceId: '', token: '', clientToken: '', baseUrl: 'https://api.z-api.io', storeId: '',
  });
  const [zapiStatus, setZapiStatus] = useState<any>(null);

  useEffect(() => {
    if (!zapiConfigs.length) return;
    const zc = (zapiConfigs as any[])[0];
    if (!zc) return;
    setZapiForm(f => ({
      ...f,
      instanceId:  zc.instanceId  ?? '',
      token:       zc.token       ?? '',
      clientToken: zc.clientToken ?? '',
      baseUrl:     zc.baseUrl     ?? 'https://api.z-api.io',
      storeId:     zc.storeId     ?? '',
    }));
  }, [zapiConfigs]);

  const zapiMut   = useMutation({ mutationFn: () => saveZapiConfig(zapiForm) });
  const statusMut = useMutation({
    mutationFn: () => getZapiStatus(),
    onSuccess:  (data) => setZapiStatus(data),
    onError:    ()     => setZapiStatus({ connected: false, error: 'Nao conectado' }),
  });

  const inputCls = 'w-full bg-[#2f2f2f] text-sm px-3 py-2 rounded-lg border border-[#343434] outline-none focus:border-primary text-[#f5f5f5] placeholder-[#b3b3b3]';
  const cardCls  = 'rounded-xl border border-[#343434] bg-[#2a2a2a] p-6 space-y-4';

  return (
    <div className="h-full flex flex-col bg-[#212121]">
      <div className="px-6 py-4 border-b border-[#343434]">
        <h1 className="text-lg font-bold text-[#f5f5f5]">Configuracoes</h1>
        <p className="text-xs text-[#b3b3b3]">IA Anthropic Claude e Z-API WhatsApp</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#343434] px-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-[#b3b3b3] hover:text-[#f5f5f5]'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">

        {/* ── ABA: IA ──────────────────────────────────────────────────────── */}
        {tab === 'ai' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl space-y-6">

            {/* Banner IA oficial */}
            <div className="flex items-center gap-4 p-4 rounded-xl border border-primary/30 bg-primary/5">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-xl shrink-0">
                🧠
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#f5f5f5]">IA oficial: Anthropic Claude</p>
                <p className="text-xs text-[#b3b3b3] mt-0.5">
                  Usada para atendimento automatico, qualificacao de leads e respostas sugeridas
                </p>
              </div>
            </div>

            {/* Card configuracao */}
            <div className={cardCls}>
              <h2 className="font-semibold text-[#f5f5f5]">Configuracao do Modelo Claude</h2>

              {/* Provider: somente Anthropic — sem seletor */}
              <div className="flex items-center gap-3 px-3 py-2 bg-[#1a1a1a] rounded-lg border border-[#343434]">
                <span className="text-xs text-[#b3b3b3]">Provider:</span>
                <span className="text-xs font-medium text-primary">Anthropic (Claude)</span>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                  Oficial
                </span>
              </div>

              {/* Modelo */}
              <div>
                <label className="text-xs text-[#b3b3b3] block mb-1">Modelo Claude</label>
                <input
                  value={aiForm.model}
                  onChange={e => setAiForm(f => ({ ...f, model: e.target.value }))}
                  className={inputCls}
                  placeholder="claude-haiku-4-5-20251001"
                />
                <p className="text-xs text-[#666] mt-1">
                  Sugestoes:&nbsp;
                  {CLAUDE_MODEL_SUGGESTIONS.map((m, i) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAiForm(f => ({ ...f, model: m }))}
                      className="text-primary hover:underline"
                    >
                      {m}{i < CLAUDE_MODEL_SUGGESTIONS.length - 1 ? ' · ' : ''}
                    </button>
                  ))}
                </p>
              </div>

              {/* Temperatura e Max Tokens */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#b3b3b3] block mb-1">Temperatura (0–1)</label>
                  <input
                    type="number" min="0" max="1" step="0.1"
                    value={aiForm.temperature}
                    onChange={e => setAiForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-xs text-[#b3b3b3] block mb-1">Max Tokens</label>
                  <input
                    type="number"
                    value={aiForm.maxTokens}
                    onChange={e => setAiForm(f => ({ ...f, maxTokens: parseInt(e.target.value) }))}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Prompt do sistema */}
              <div>
                <label className="text-xs text-[#b3b3b3] block mb-1">Prompt do Sistema</label>
                <textarea
                  value={aiForm.systemPrompt}
                  onChange={e => setAiForm(f => ({ ...f, systemPrompt: e.target.value }))}
                  rows={4}
                  placeholder="Deixe vazio para usar o prompt padrao de SDR comercial..."
                  className={cn(inputCls, 'resize-none')}
                />
                <p className="text-xs text-[#666] mt-1">
                  Se vazio, usa o prompt padrao da Ana (consultora comercial Tecle Motos).
                </p>
              </div>

              <button
                onClick={() => aiMut.mutate()}
                disabled={aiMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                {aiMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
              {aiMut.isSuccess && <p className="text-sm text-green-400">Configuracao salva!</p>}
            </div>

            {/* Card teste de IA */}
            <div className={cardCls}>
              <h2 className="font-semibold text-[#f5f5f5] flex items-center gap-2">
                <TestTube2 className="w-4 h-4 text-primary" />
                Testar IA
              </h2>
              <textarea
                value={testMsg}
                onChange={e => setTestMsg(e.target.value)}
                rows={2}
                className={cn(inputCls, 'resize-none')}
                placeholder="Digite uma mensagem de cliente para testar..."
              />
              <button
                onClick={() => testMut.mutate()}
                disabled={testMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-[#343434] text-[#f5f5f5] rounded-lg text-sm font-medium hover:bg-[#3a3a3a] disabled:opacity-60"
              >
                {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                Testar
              </button>
              {testResult && (
                <div className="bg-[#343434] rounded-lg p-3">
                  <p className="text-xs text-[#b3b3b3] mb-1">Resposta da Ana (Claude):</p>
                  <p className="text-sm text-[#f5f5f5]">{testResult}</p>
                </div>
              )}
              {testMut.isError && (
                <p className="text-sm text-red-400">
                  Erro ao testar IA. Verifique se ANTHROPIC_API_KEY está configurada no .env.
                </p>
              )}
            </div>

          </motion.div>
        )}

        {/* ── ABA: Z-API ───────────────────────────────────────────────────── */}
        {tab === 'zapi' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl space-y-6">
            <div className={cardCls}>
              <h2 className="font-semibold text-[#f5f5f5]">Configuracao Z-API</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#b3b3b3] block mb-1">Instance ID</label>
                  <input
                    value={zapiForm.instanceId}
                    onChange={e => setZapiForm(f => ({ ...f, instanceId: e.target.value }))}
                    className={inputCls}
                    placeholder="sua-instancia"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#b3b3b3] block mb-1">Token</label>
                  <input
                    type="password"
                    value={zapiForm.token}
                    onChange={e => setZapiForm(f => ({ ...f, token: e.target.value }))}
                    className={inputCls}
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-[#b3b3b3] block mb-1">Client Token (opcional)</label>
                <input
                  type="password"
                  value={zapiForm.clientToken}
                  onChange={e => setZapiForm(f => ({ ...f, clientToken: e.target.value }))}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="text-xs text-[#b3b3b3] block mb-1">URL Base</label>
                <input
                  value={zapiForm.baseUrl}
                  onChange={e => setZapiForm(f => ({ ...f, baseUrl: e.target.value }))}
                  className={inputCls}
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
                  className="flex items-center gap-2 px-4 py-2 bg-[#343434] text-[#f5f5f5] rounded-lg text-sm font-medium hover:bg-[#3a3a3a] disabled:opacity-60"
                >
                  {statusMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Testar Conexao
                </button>
              </div>
              {zapiStatus && (
                <div className={cn(
                  'rounded-lg p-3 text-sm flex items-center gap-2',
                  zapiStatus.connected ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                )}>
                  {zapiStatus.connected
                    ? <><CheckCircle className="w-4 h-4" /> Conectado ao WhatsApp</>
                    : <><XCircle className="w-4 h-4" /> {zapiStatus.error || 'Nao conectado'}</>
                  }
                </div>
              )}
              <div className="bg-[#343434] rounded-lg p-3">
                <p className="text-xs text-[#b3b3b3] font-medium mb-1">URL do Webhook</p>
                <code className="text-xs text-primary break-all">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/zapi
                </code>
                <p className="text-xs text-[#b3b3b3] mt-1">
                  Header: <code className="text-primary">x-webhook-secret: &lt;WEBHOOK_SECRET&gt;</code>
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── ABA: INTEGRACOES ─────────────────────────────────────────────── */}
        {tab === 'integrations' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-[#f5f5f5]">Status das Integracoes</h2>
              <p className="text-xs text-[#b3b3b3] mt-1">
                Servicos ativos no Axion Conversa
              </p>
            </div>

            {loadingIntegrations ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {integrations && Object.entries(integrations).map(([key, info]: [string, any]) => (
                  <div
                    key={key}
                    className={cn(
                      'rounded-xl border p-4 flex items-start gap-4 transition-colors',
                      info.configured
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-[#343434] bg-[#2a2a2a]'
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0',
                      info.configured ? 'bg-green-500/15' : 'bg-[#343434]'
                    )}>
                      {INTEGRATION_ICONS[key] ?? '🔌'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#f5f5f5] truncate">{info.label}</p>
                        <span className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full border shrink-0 flex items-center gap-1',
                          info.configured
                            ? 'bg-green-500/15 text-green-400 border-green-500/30'
                            : 'bg-[#343434] text-[#b3b3b3] border-[#3a3a3a]'
                        )}>
                          {info.configured
                            ? <><CheckCircle className="w-2.5 h-2.5" /> Configurado</>
                            : <><XCircle className="w-2.5 h-2.5" /> Nao configurado</>
                          }
                        </span>
                      </div>
                      <p className="text-xs text-[#b3b3b3] mt-0.5 truncate">{info.detail}</p>
                      {info.docsUrl && (
                        <a
                          href={info.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
                        >
                          Documentacao <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

      </div>
    </div>
  );
}
