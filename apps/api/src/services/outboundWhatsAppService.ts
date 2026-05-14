import { sendTextMessage } from './zapiService';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type OutboundSource = 'manual' | 'flow' | 'ai' | 'system';

export interface SendWhatsAppTextParams {
  conversationId: string;
  storeId:        string | null | undefined;
  phone:          string;   // aceita qualquer formato; normalizado internamente
  text:           string;
  source:         OutboundSource;
}

export interface SendWhatsAppTextResult {
  ok:          boolean;
  phone:       string;  // número normalizado usado no envio
  zapiResponse?: any;
  error?:      string;
  httpStatus?: number;
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

/** Remove não-dígitos e garante prefixo 55 brasileiro sem duplicação. */
function normalizePhone(raw: string): string | null {
  const digits  = raw.replace(/\D/g, '');
  const withDdi = digits.startsWith('55') ? digits : `55${digits}`;
  // Mínimo: 55 + DDD(2) + número(8) = 12 dígitos
  if (withDdi.length < 12) return null;
  return withDdi;
}

/** Mascara o telefone para log seguro: "5511999999999" → "5511****999". */
function maskPhone(phone: string): string {
  if (phone.length <= 7) return '****';
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

// ─── Serviço central de saída WhatsApp ───────────────────────────────────────
/**
 * ÚNICO ponto de saída de mensagens WhatsApp no CRM.
 * Todos os caminhos (manual, flow, ai, system) devem passar por aqui.
 *
 * Nunca lança exceção — sempre retorna { ok, ... }.
 * Nunca loga tokens ou secrets.
 */
export async function sendWhatsAppText(
  params: SendWhatsAppTextParams,
): Promise<SendWhatsAppTextResult> {
  const { conversationId, storeId, phone, text, source } = params;

  // Valida e normaliza o telefone
  const normalized = normalizePhone(phone);
  if (!normalized) {
    const msg = `Telefone inválido ou curto demais: "${phone.replace(/\d/g, '*')}"`;
    console.error(
      `[WHATSAPP_SEND_ERROR] | source: ${source} | conv: ${conversationId} | phone: invalid | erro: ${msg}`,
    );
    return { ok: false, phone: phone, error: msg };
  }

  const masked = maskPhone(normalized);

  // Valida texto
  const trimmed = text.trim();
  if (!trimmed) {
    console.warn(`[WHATSAPP_SEND_ERROR] | source: ${source} | conv: ${conversationId} | phone: ${masked} | erro: texto vazio`);
    return { ok: false, phone: normalized, error: 'Texto vazio' };
  }

  console.log(
    `[WHATSAPP_SEND_ATTEMPT] | source: ${source} | conv: ${conversationId} | phone: ${masked}`,
  );

  try {
    const zapiResponse = await sendTextMessage(normalized, trimmed, storeId);

    console.log(
      `[WHATSAPP_SEND_OK] | source: ${source} | conv: ${conversationId} | phone: ${masked}`,
    );

    return { ok: true, phone: normalized, zapiResponse };

  } catch (e: any) {
    const httpStatus  = (e?.response?.status  as number | undefined) ?? undefined;
    // Sanitiza a resposta: remove qualquer campo que pareça token/key
    const rawData     = e?.response?.data;
    const safeData    = rawData
      ? JSON.stringify(rawData).replace(/"(token|key|secret|password|auth)":\s*"[^"]+"/gi, '"$1":"***"')
      : undefined;
    const errDetail   = e?.response?.data?.message || e?.message || 'unknown';

    console.error(
      `[WHATSAPP_SEND_ERROR] | source: ${source} | conv: ${conversationId} | phone: ${masked}` +
      ` | status: ${httpStatus ?? 'N/A'} | erro: ${errDetail}` +
      (safeData ? ` | body: ${safeData}` : ''),
    );

    return {
      ok:          false,
      phone:       normalized,
      error:       errDetail,
      httpStatus,
    };
  }
}
