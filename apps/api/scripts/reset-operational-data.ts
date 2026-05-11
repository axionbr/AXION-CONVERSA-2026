/**
 * reset-operational-data.ts
 *
 * Limpa dados OPERACIONAIS do CRM preservando toda estrutura e configuração.
 *
 * ✅ MANTÉM:  usuários, vendedores, lojas, configurações, flows, tags, campos, tokens, .env
 * 🗑️  APAGA:   mensagens, conversas, leads, contatos, notificações, logs, execuções
 *
 * Como rodar:
 *   Local:  npm run db:reset-operational  (dentro de apps/api/)
 *   VPS:    cd /var/www/axion-conversa && npx tsx apps/api/scripts/reset-operational-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Cores para terminal ──────────────────────────────────────────────────────
const C = {
  RED:    '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN:  '\x1b[32m',
  CYAN:   '\x1b[36m',
  BOLD:   '\x1b[1m',
  RESET:  '\x1b[0m',
};

function warn(msg: string)  { console.log(`${C.YELLOW}  ⚠️  ${msg}${C.RESET}`); }
function ok(msg: string)    { console.log(`${C.GREEN}  ✅ ${msg}${C.RESET}`); }
function info(msg: string)  { console.log(`${C.CYAN}  ℹ️  ${msg}${C.RESET}`); }
function title(msg: string) { console.log(`\n${C.BOLD}${C.RED}${msg}${C.RESET}`); }

async function main() {
  title('🔴  RESET OPERACIONAL — AXION CONVERSA 2026');
  console.log('═'.repeat(55));

  warn('Este script apagará PERMANENTEMENTE os dados operacionais.');
  warn('Usuários, lojas, configurações e fluxos serão MANTIDOS.');
  console.log();

  // ─── 1. Contagem antes ──────────────────────────────────────────────────────
  info('Contando registros antes do reset...\n');

  const [
    cntContacts,
    cntLeads,
    cntConversations,
    cntMessages,
    cntNotifications,
    cntAutomationLogs,
    cntFlowExecutions,
    cntFlowSteps,
    // Preservados
    cntUsers,
    cntStores,
    cntFlows,
  ] = await Promise.all([
    prisma.contact.count(),
    prisma.lead.count(),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.sellerNotification.count(),
    prisma.automationLog.count(),
    prisma.flowExecution.count(),
    prisma.flowExecutionStep.count(),
    // Preservados
    prisma.user.count(),
    prisma.store.count(),
    prisma.flow.count(),
  ]);

  console.log('  📊 Tabelas a serem LIMPAS:');
  console.log(`     contacts           : ${cntContacts}`);
  console.log(`     leads              : ${cntLeads}`);
  console.log(`     conversations      : ${cntConversations}`);
  console.log(`     messages           : ${cntMessages}`);
  console.log(`     seller_notif       : ${cntNotifications}`);
  console.log(`     automation_logs    : ${cntAutomationLogs}`);
  console.log(`     flow_exec_steps    : ${cntFlowSteps}`);
  console.log(`     flow_executions    : ${cntFlowExecutions}`);
  console.log();
  console.log('  🔒 Tabelas PRESERVADAS:');
  console.log(`     users              : ${cntUsers}`);
  console.log(`     stores             : ${cntStores}`);
  console.log(`     flows              : ${cntFlows}`);
  console.log(`     ai_configs, zapi_configs, tags, custom_fields → mantidos`);
  console.log();

  const totalToDelete =
    cntContacts + cntLeads + cntConversations + cntMessages +
    cntNotifications + cntAutomationLogs + cntFlowExecutions + cntFlowSteps;

  if (totalToDelete === 0) {
    ok('Nenhum dado operacional encontrado. Banco já está limpo!');
    return;
  }

  warn(`Total de registros a remover: ${totalToDelete}`);
  console.log();

  // ─── 2. Confirmação manual ──────────────────────────────────────────────────
  const env = process.env.FORCE_RESET;
  if (env !== 'true') {
    console.log(`  ${C.BOLD}Para confirmar o reset, rode:${C.RESET}`);
    console.log(`  ${C.CYAN}FORCE_RESET=true npm run db:reset-operational${C.RESET}`);
    console.log();
    console.log('  Abortando sem alterações.');
    return;
  }

  // ─── 3. Deletar na ordem correta (respeitar FK) ────────────────────────────
  console.log('\n  🗑️  Iniciando limpeza...\n');

  const r_steps  = await prisma.flowExecutionStep.deleteMany({});
  ok(`flow_execution_steps : ${r_steps.count} removidos`);

  const r_execs  = await prisma.flowExecution.deleteMany({});
  ok(`flow_executions      : ${r_execs.count} removidos`);

  const r_notif  = await prisma.sellerNotification.deleteMany({});
  ok(`seller_notifications : ${r_notif.count} removidas`);

  const r_logs   = await prisma.automationLog.deleteMany({});
  ok(`automation_logs      : ${r_logs.count} removidos`);

  const r_msgs   = await prisma.message.deleteMany({});
  ok(`messages             : ${r_msgs.count} removidas`);

  const r_convs  = await prisma.conversation.deleteMany({});
  ok(`conversations        : ${r_convs.count} removidas`);

  const r_ltags  = await prisma.leadTag.deleteMany({});
  ok(`lead_tags            : ${r_ltags.count} removidos`);

  const r_cfvs   = await prisma.customFieldValue.deleteMany({});
  ok(`custom_field_values  : ${r_cfvs.count} removidos`);

  const r_leads  = await prisma.lead.deleteMany({});
  ok(`leads                : ${r_leads.count} removidos`);

  const r_conts  = await prisma.contact.deleteMany({});
  ok(`contacts             : ${r_conts.count} removidos`);

  // ─── 4. Resumo final ────────────────────────────────────────────────────────
  const total =
    r_steps.count + r_execs.count + r_notif.count + r_logs.count +
    r_msgs.count + r_convs.count + r_ltags.count + r_cfvs.count +
    r_leads.count + r_conts.count;

  console.log();
  console.log('═'.repeat(55));
  ok(`Reset concluído! ${total} registros removidos.`);
  console.log();
  console.log(`  ${C.BOLD}Resumo:${C.RESET}`);
  console.log(`    Contatos removidos     : ${r_conts.count}`);
  console.log(`    Leads removidos        : ${r_leads.count}`);
  console.log(`    Conversas removidas    : ${r_convs.count}`);
  console.log(`    Mensagens removidas    : ${r_msgs.count}`);
  console.log(`    Notificações removidas : ${r_notif.count}`);
  console.log(`    Logs de automação      : ${r_logs.count}`);
  console.log(`    Execuções de fluxo     : ${r_execs.count + r_steps.count}`);
  console.log();
  ok('Sistema pronto para nova operação com IA automática!');
}

main()
  .catch(e => { console.error('\n❌ Erro no reset:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
