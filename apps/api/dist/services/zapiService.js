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
    let instanceId = config_1.config.zapi.instanceId;
    let token = config_1.config.zapi.token;
    let clientToken = config_1.config.zapi.clientToken;
    let baseUrl = config_1.config.zapi.baseUrl;
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
    const headers = { 'Content-Type': 'application/json' };
    if (clientToken)
        headers['client-token'] = clientToken;
    const cleanPhone = phone.replace(/\D/g, '');
    const response = await axios_1.default.post(url, { phone: cleanPhone, message }, { headers });
    return response.data;
}
async function getInstanceStatus(storeId) {
    let instanceId = config_1.config.zapi.instanceId;
    let token = config_1.config.zapi.token;
    let clientToken = config_1.config.zapi.clientToken;
    let baseUrl = config_1.config.zapi.baseUrl;
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
    const headers = {};
    if (clientToken)
        headers['client-token'] = clientToken;
    const response = await axios_1.default.get(url, { headers });
    return response.data;
}
//# sourceMappingURL=zapiService.js.map