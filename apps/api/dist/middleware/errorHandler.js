"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
function errorHandler(err, req, res, next) {
    console.error(err);
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Erro interno do servidor';
    res.status(status).json({ error: message });
}
//# sourceMappingURL=errorHandler.js.map