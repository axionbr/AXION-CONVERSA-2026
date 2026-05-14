import axios from 'axios';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function sendTextMessage(phone: string, message: string, storeId?: string | null): Promise<any> {
  // Parte dos defaults do .env — campos do ZapiConfig do banco só sobrescrevem se preenchidos
  let instanceId  = config.zapi.instanceId;
  let token       = config.zapi.token;
  let clientToken = config.zapi.clientToken;
  let baseUrl     = config.zapi.baseUrl;
  let configSource = 'env';

  if (storeId) {
    const zapiConf = await prisma.zapiConfig.findUnique({ where: { storeId } });
    if (zapiConf && zapiConf.instanceId && zapiConf.token) {
      // Usa credenciais da loja para campos preenchidos; campos vazios caem no .env global.
      // Isso evita que clientToken null quebre o envio quando o ZapiConfig foi salvo sem ele.
      instanceId  = zapiConf.instanceId;
      token       = zapiConf.token;
      clientToken = zapiConf.clientToken  || config.zapi.clientToken;
      baseUrl     = zapiConf.baseUrl      || config.zapi.baseUrl;
      configSource = `store:${storeId}`;
    }
  }

  if (!instanceId || !token) {
    console.warn('[ZAPI_CONFIG] Z-API não configurado — instanceId ou token ausentes, envio cancelado');
    return null;
  }

  if (!clientToken) {
    console.warn('[ZAPI_CONFIG] ZAPI_CLIENT_TOKEN ausente — envio pode ser rejeitado com 403');
  }

  const cleanPhone = phone.replace(/\D/g, '');

  // Log diagnóstico sem expor token/secret
  console.log(
    `[ZAPI_CONFIG] source: ${configSource} | instance: ${instanceId.slice(0, 6)}... | phone: ${cleanPhone.slice(0, 4)}****${cleanPhone.slice(-3)} | clientToken: ${clientToken ? 'presente' : 'AUSENTE'}`,
  );

  const url     = `${baseUrl}/instances/${instanceId}/token/${token}/send-text`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (clientToken) headers['Client-Token'] = clientToken;

  const response = await axios.post(url, { phone: cleanPhone, message }, {
    headers,
    timeout: 15_000,
  });
  return response.data;
}

export async function getInstanceStatus(storeId?: string | null): Promise<any> {
  let instanceId  = config.zapi.instanceId;
  let token       = config.zapi.token;
  let clientToken = config.zapi.clientToken;
  let baseUrl     = config.zapi.baseUrl;

  if (storeId) {
    const zapiConf = await prisma.zapiConfig.findUnique({ where: { storeId } });
    if (zapiConf && zapiConf.instanceId && zapiConf.token) {
      instanceId  = zapiConf.instanceId;
      token       = zapiConf.token;
      clientToken = zapiConf.clientToken || config.zapi.clientToken;
      baseUrl     = zapiConf.baseUrl     || config.zapi.baseUrl;
    }
  }

  const url     = `${baseUrl}/instances/${instanceId}/token/${token}/status`;
  const headers: Record<string, string> = {};
  if (clientToken) headers['Client-Token'] = clientToken;

  const response = await axios.get(url, { headers, timeout: 10_000 });
  return response.data;
}
