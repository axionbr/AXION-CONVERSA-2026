"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processZapiWebhook = processZapiWebhook;
const client_1 = require("@prisma/client");
const aiService_1 = require("./aiService");
const zapiService_1 = require("./zapiService");
const socket_1 = require("../socket");
const flowEngine_1 = require("./flowEngine");
const prisma = new client_1.PrismaClient();
const OPEN_STATUSES = ['NOVO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'];
const AI_BLOCKED_MODES = ['HUMANO', 'PAUSADO'];
const AI_BLOCKED_STATUSES = ['FECHADO'];
function extractPayload(payload) {
    // Só processa ReceivedCallback; ignora SentCallback, DeliveryCallback etc.
    if (payload.type && payload.type !== 'ReceivedCallback')
        return null;
    // Ignorar mensagens enviadas pelo próprio número (evita loop infinito)
    if (payload.fromMe === true)
        return null;
    // Ignorar grupos
    if (payload.isGroup)
        return null;
    const rawPhoneStr = payload.phone || payload.from || '';
    if (!rawPhoneStr)
        return null;
    // Suporte a diferentes estruturas de payload Z-API
    const content = payload.text?.message ||
        payload.body ||
        payload.message?.conversation ||
        payload.message?.extendedTextMessage?.text ||
        '';
    if (!content || typeof content !== 'string' || !content.trim())
        return null;
    const rawPhone = rawPhoneStr.replace(/\D/g, ''); // "5511999999999"
    const normalizedPhone = rawPhone.replace(/^55/, ''); // "11999999999"
    if (normalizedPhone.length < 10)
        return null;
    return {
        normalizedPhone,
        rawPhone,
        content: content.trim(),
        messageId: payload.messageId || payload.id,
        senderName: payload.senderName || payload.pushName || normalizedPhone,
    };
}
async function processZapiWebhook(payload) {
    console.log('[WEBHOOK] Payload recebido:', JSON.stringify(payload).substring(0, 300));
    try {
        const extracted = extractPayload(payload);
        if (!extracted) {
            console.log('[WEBHOOK] Payload descartado (fromMe, grupo, tipo não-inbound ou sem conteúdo)');
            return;
        }
        const { normalizedPhone, rawPhone, content, messageId, senderName } = extracted;
        console.log(`[WEBHOOK] Mensagem inbound | de: ${normalizedPhone} | "${content.substring(0, 80)}"`);
        // ── 1. Contato ────────────────────────────────────────────────────────────
        let contact = await prisma.contact.findUnique({ where: { phone: normalizedPhone } });
        if (!contact) {
            contact = await prisma.contact.create({
                data: { name: senderName, phone: normalizedPhone },
            });
        }
        else if (contact.name !== senderName && senderName !== normalizedPhone) {
            await prisma.contact.update({ where: { id: contact.id }, data: { name: senderName } });
        }
        // ── 2. Loja e atendente padrão ────────────────────────────────────────────
        const defaultStore = await prisma.store.findFirst({ where: { active: true } });
        const defaultUser = defaultStore
            ? await prisma.user.findFirst({
                where: { storeId: defaultStore.id, role: { in: ['VENDEDOR', 'ATENDENTE'] }, active: true },
            })
            : null;
        // ── 3. Lead ───────────────────────────────────────────────────────────────
        let lead = await prisma.lead.findFirst({ where: { phone: normalizedPhone } });
        const isNewLead = !lead;
        if (!lead) {
            lead = await prisma.lead.create({
                data: {
                    name: senderName,
                    phone: normalizedPhone,
                    source: 'WhatsApp',
                    contactId: contact.id,
                    storeId: defaultStore?.id,
                    assignedUserId: defaultUser?.id,
                },
            });
        }
        // ── 4. Conversa ───────────────────────────────────────────────────────────
        let conversation = await prisma.conversation.findFirst({
            where: { contactId: contact.id, status: { in: OPEN_STATUSES } },
            orderBy: { createdAt: 'desc' },
        });
        const isNewConversation = !conversation;
        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    contactId: contact.id,
                    leadId: lead.id,
                    storeId: defaultStore?.id,
                    assignedUserId: defaultUser?.id,
                    status: 'NOVO',
                    lastMessageAt: new Date(),
                },
            });
        }
        else if (conversation.status === 'AGUARDANDO_CLIENTE') {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: { status: 'EM_ATENDIMENTO' },
            });
        }
        // ── 5. Salvar mensagem INBOUND ────────────────────────────────────────────
        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'INBOUND',
                type: 'TEXT',
                content,
                providerMessageId: messageId,
                senderType: 'CLIENT',
            },
        });
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
        });
        console.log(`[WEBHOOK] Mensagem salva | msg: ${message.id} | conversa: ${conversation.id}`);
        // ── 6. Classificação de intenção ──────────────────────────────────────────
        const classification = await (0, aiService_1.classifyIntentAndTemperature)(content);
        await prisma.lead.update({
            where: { id: lead.id },
            data: {
                temperature: classification.temperature,
                score: Math.max(lead.score, classification.score),
            },
        });
        // ── 7. Log de automação ───────────────────────────────────────────────────
        await prisma.automationLog.create({
            data: {
                type: 'WEBHOOK_RECEIVED',
                description: `Mensagem recebida de ${normalizedPhone}`,
                data: JSON.stringify({ classification }),
                conversationId: conversation.id,
                leadId: lead.id,
            },
        });
        // ── 8. Socket.IO em tempo real ────────────────────────────────────────────
        const msgPayload = {
            id: message.id,
            conversationId: conversation.id,
            direction: message.direction,
            type: message.type,
            content: message.content,
            senderType: 'CLIENT',
            createdAt: message.createdAt.toISOString(),
        };
        (0, socket_1.emitNewMessage)(conversation.id, msgPayload);
        if (isNewConversation) {
            (0, socket_1.emitNewConversation)({ conversationId: conversation.id, contact, lead });
        }
        else {
            (0, socket_1.emitConversationUpdate)(conversation.id, {
                lastMessageAt: new Date(),
                unreadCount: (conversation.unreadCount ?? 0) + 1,
                temperature: classification.temperature,
            });
        }
        // ── 9. Gatilhos de fluxo ──────────────────────────────────────────────────
        await (0, flowEngine_1.triggerFlowsByEvent)('KEYWORD', content, conversation.id, lead.id);
        if (isNewLead) {
            await (0, flowEngine_1.triggerFlowsByEvent)('FIRST_MESSAGE', content, conversation.id, lead.id);
            await (0, flowEngine_1.triggerFlowsByEvent)('LEAD_CREATED', content, conversation.id, lead.id);
        }
        // ── 10. Verificar se IA deve responder ────────────────────────────────────
        const freshConv = await prisma.conversation.findUnique({ where: { id: conversation.id } });
        if (!freshConv?.aiEnabled) {
            console.log('[IA] IA desabilitada nesta conversa — sem resposta automática');
            return;
        }
        if (AI_BLOCKED_MODES.includes(freshConv.mode)) {
            console.log(`[IA] Modo "${freshConv.mode}" bloqueia resposta automática`);
            return;
        }
        if (AI_BLOCKED_STATUSES.includes(freshConv.status)) {
            console.log(`[IA] Status "${freshConv.status}" bloqueia resposta automática`);
            return;
        }
        console.log(`[IA] Chamando Claude | conversa: ${conversation.id} | modo: ${freshConv.mode}`);
        // ── 11. Montar histórico e chamar IA ──────────────────────────────────────
        const recentMessages = await prisma.message.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'asc' },
            take: 20,
        });
        const chatHistory = recentMessages.map((m) => ({
            role: (m.direction === 'INBOUND' ? 'user' : 'assistant'),
            content: m.content,
        }));
        let aiReply;
        try {
            aiReply = await (0, aiService_1.generateAiResponse)(conversation.id, chatHistory, conversation.storeId);
        }
        catch (aiErr) {
            console.error('[IA] Erro ao chamar Claude:', aiErr.message);
            return;
        }
        if (!aiReply) {
            console.warn('[IA] Claude retornou resposta vazia — pulando envio');
            return;
        }
        console.log(`[IA] Resposta gerada: "${aiReply.substring(0, 100)}"`);
        // ── 12. Salvar mensagem OUTBOUND ──────────────────────────────────────────
        const aiMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'OUTBOUND',
                type: 'TEXT',
                content: aiReply,
                senderType: 'AI',
            },
        });
        // ── 13. Enviar via Z-API usando rawPhone (com DDI "55") ───────────────────
        try {
            await (0, zapiService_1.sendTextMessage)(rawPhone, aiReply, conversation.storeId);
            console.log(`[ZAPI] Mensagem enviada com sucesso para ${rawPhone}`);
        }
        catch (zapErr) {
            console.error(`[ZAPI] Falha ao enviar para ${rawPhone}:`, zapErr.message);
        }
        // ── 14. Emitir resposta da IA em tempo real ───────────────────────────────
        (0, socket_1.emitNewMessage)(conversation.id, {
            id: aiMessage.id,
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            type: 'TEXT',
            content: aiReply,
            senderType: 'AI',
            createdAt: aiMessage.createdAt.toISOString(),
        });
        await prisma.automationLog.create({
            data: {
                type: 'AI_RESPONSE',
                description: `IA respondeu na conversa ${conversation.id}`,
                data: null,
                conversationId: conversation.id,
                leadId: lead.id,
            },
        });
        console.log(`[IA] Fluxo completo | conversa: ${conversation.id} | msg outbound: ${aiMessage.id}`);
    }
    catch (err) {
        console.error('[WEBHOOK] Erro no processamento:', err.message, '\n', err.stack);
        throw err;
    }
}
//# sourceMappingURL=webhookProcessor.js.map