"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTextMessage = sendTextMessage;
exports.getInstanceStatus = getInstanceStatus;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function sendTextMessage(phone, message, storeId) {
    // Parte dos defaults do .env — campos do ZapiConfig do banco só sobrescrevem se preenchidos
    let instanceId = config_1.config.zapi.instanceId;
    let token = config_1.config.zapi.token;
    let clientToken = config_1.config.zapi.clientToken;
    let baseUrl = config_1.config.zapi.baseUrl;
    let configSource = 'env';
    if (storeId) {
        const zapiConf = await prisma.zapiConfig.findUnique({ where: { storeId } });
        if (zapiConf && zapiConf.instanceId && zapiConf.token) {
            // Usa credenciais da loja para campos preenchidos; campos vazios caem no .env global.
            // Isso evita que clientToken null quebre o envio quando o ZapiConfig foi salvo sem ele.
            instanceId = zapiConf.instanceId;
            token = zapiConf.token;
            clientToken = zapiConf.clientToken || config_1.config.zapi.clientToken;
            baseUrl = zapiConf.baseUrl || config_1.config.zapi.baseUrl;
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
    console.log(`[ZAPI_CONFIG] source: ${configSource} | instance: ${instanceId.slice(0, 6)}... | phone: ${cleanPhone.slice(0, 4)}****${cleanPhone.slice(-3)} | clientToken: ${clientToken ? 'presente' : 'AUSENTE'}`);
    const url = `${baseUrl}/instances/${instanceId}/token/${token}/send-text`;
    const headers = { 'Content-Type': 'application/json' };
    if (clientToken)
        headers['Client-Token'] = clientToken;
    const response = await axios_1.default.post(url, { phone: cleanPhone, message }, {
        headers,
        timeout: 15000,
    });
    return response.data;
}
async function getInstanceStatus(storeId) {
    let instanceId = config_1.config.zapi.instanceId;
    let token = config_1.config.zapi.token;
    let clientToken = config_1.config.zapi.clientToken;
    let baseUrl = config_1.config.zapi.baseUrl;
    if (storeId) {
        const zapiConf = await prisma.zapiConfig.findUnique({ where: { storeId } });
        if (zapiConf && zapiConf.instanceId && zapiConf.token) {
            instanceId = zapiConf.instanceId;
            token = zapiConf.token;
            clientToken = zapiConf.clientToken || config_1.config.zapi.clientToken;
            baseUrl = zapiConf.baseUrl || config_1.config.zapi.baseUrl;
        }
    }
    const url = `${baseUrl}/instances/${instanceId}/token/${token}/status`;
    const headers = {};
    if (clientToken)
        headers['Client-Token'] = clientToken;
    const response = await axios_1.default.get(url, { headers, timeout: 10000 });
    return response.data;
}
//# sourceMappingURL=zapiService.js.map