"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
        req.user = payload;
        next();
    }
    catch {
        return res.status(401).json({ error: 'Token inválido' });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Permissão insuficiente' });
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map