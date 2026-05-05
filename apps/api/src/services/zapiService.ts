import axios from 'axios';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ZapiMessage {
  phone: string;
  message: string;
}

export async function sendTextMessage(phone: string, message: string, storeId?: string | null): Promise<any> {
  let instanceId = config.zapi.instanceId;
  let token = config.zapi.token;
  let clientToken = config.zapi.clientToken;
  let baseUrl = config.zapi.baseUrl;

  if (storeId) {
    const zapiConf = await prisma.zapiConfig.findUnique({ where: { storeId } });
    if (zapiConf) {
      instanceId = zapiConf.instanceId;
      token = zapiConf.token;
      clientToken = zapiConf.clientToken || '';
      baseUrl = zapiConf.baseUrl;
    }
  }

  if (!instanceId || !token) {
    console.warn('Z-API not configured, skipping message send');
    return null;
  }

  const url = `${baseUrl}/instances/${instanceId}/token/${token}/send-text`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (clientToken) headers['client-token'] = clientToken;

  const cleanPhone = phone.replace(/\D/g, '');

  const response = await axios.post(url, { phone: cleanPhone, message }, { headers });
  return response.data;
}

export async function getInstanceStatus(storeId?: string | null): Promise<any> {
  let instanceId = config.zapi.instanceId;
  let token = config.zapi.token;
  let clientToken = config.zapi.clientToken;
  let baseUrl = config.zapi.baseUrl;

  if (storeId) {
    const zapiConf = await prisma.zapiConfig.findUnique({ where: { storeId } });
    if (zapiConf) {
      instanceId = zapiConf.instanceId;
      token = zapiConf.token;
      clientToken = zapiConf.clientToken || '';
      baseUrl = zapiConf.baseUrl;
    }
  }

  const url = `${baseUrl}/instances/${instanceId}/token/${token}/status`;
  const headers: Record<string, string> = {};
  if (clientToken) headers['client-token'] = clientToken;

  const response = await axios.get(url, { headers });
  return response.data;
}
