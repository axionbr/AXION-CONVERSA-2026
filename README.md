# AXION CONVERSA 2026

Plataforma de atendimento via WhatsApp com IA, CRM e automação de fluxos.

## Stack

- **API**: Node.js + Express + Prisma + PostgreSQL + Socket.IO
- **Web**: React + Vite + Tailwind CSS + shadcn/ui + Framer Motion + React Flow
- **IA**: OpenAI GPT e Anthropic Claude
- **WhatsApp**: Z-API

## Requisitos

- Node.js 18+
- PostgreSQL 15+
- npm 9+

## Início rápido

```bash
# 1. Clone e instale dependências
npm install

# 2. Configure o ambiente
cp .env.example apps/api/.env
# Edite apps/api/.env com suas credenciais

# 3. Crie e migre o banco de dados
npm run db:migrate

# 4. Popule com dados iniciais
npm run db:seed

# 5. Inicie em desenvolvimento
npm run dev
```

## URLs

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001
- **Prisma Studio**: http://localhost:5555

## Credenciais padrão (seed)

- **Admin**: admin@axion.com / admin123
- **Diretor**: diretor@axion.com / admin123
- **Gerente**: gerente@loja1.com / admin123
- **Vendedor**: vendedor@loja1.com / admin123

## Comandos úteis

```bash
npm run dev           # Inicia API + Web em paralelo
npm run dev:api       # Apenas API
npm run dev:web       # Apenas Web
npm run db:migrate    # Aplica migrações Prisma
npm run db:seed       # Popula banco com dados de teste
npm run db:studio     # Abre Prisma Studio
npm run build         # Build completo
```

## Configurar Webhook Z-API

No painel Z-API, configure o webhook para:
```
POST https://seu-dominio.com/api/webhooks/zapi
Header: x-webhook-secret: <WEBHOOK_SECRET do .env>
```
