#!/bin/bash
# ─── AXION CONVERSA 2026 — Deploy VPS ────────────────────────────────────────
# Servidor: 187.127.21.208
# Caminho:  /var/www/axion-crm
# PM2:      axion-crm

set -e
APP_DIR="/var/www/axion-crm"
PM2_NAME="axion-crm"

echo "──────────────────────────────────────────"
echo "🚀 DEPLOY AXION CONVERSA 2026"
echo "──────────────────────────────────────────"

# 1. Instala Node 20 se não tiver
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
  echo "📦 Instalando Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# 2. Instala PM2 globalmente se não tiver
if ! command -v pm2 &>/dev/null; then
  echo "📦 Instalando PM2..."
  npm install -g pm2
fi

# 3. Cria ou atualiza o projeto
if [ -d "$APP_DIR/.git" ]; then
  echo "📥 Atualizando projeto..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "📥 Clonando projeto..."
  mkdir -p /var/www
  git clone https://github.com/axionbr/AXION-CONVERSA-2026.git "$APP_DIR"
  cd "$APP_DIR"
fi

# 4. Instala dependências
echo "📦 Instalando dependências..."
npm install

# 5. Cria o .env da API se não existir
if [ ! -f "$APP_DIR/apps/api/.env" ]; then
  echo "⚙️  Criando .env da API..."
  cat > "$APP_DIR/apps/api/.env" << 'ENVEOF'
DATABASE_URL="file:./dev.db"
JWT_SECRET=axion-crm-producao-2026-jwt-seguro
JWT_EXPIRES_IN=7d
ANTHROPIC_API_KEY=COLOQUE_SUA_CHAVE_ANTHROPIC_AQUI
AI_PROVIDER=anthropic
AI_MODEL=claude-haiku-4-5-20251001
ZAPI_INSTANCE_ID=3F260803C1D5C2FE37CD6244BF24326C
ZAPI_TOKEN=D4244EF2DB8E04E225CF27FD
ZAPI_CLIENT_TOKEN=F7af15c408a2d46c7ae1ba076a223fc18S
ZAPI_BASE_URL=https://api.z-api.io
PORT=3002
NODE_ENV=production
FRONTEND_URL=http://187.127.21.208:5174
WEBHOOK_SECRET=axion-webhook-secret-2026
ENVEOF
  echo "✅ .env criado"
else
  echo "✅ .env já existe — mantido"
fi

# 6. Prisma
echo "🗄️  Configurando banco..."
cd "$APP_DIR/apps/api"
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts

# 7. Build
echo "🔨 Fazendo build..."
cd "$APP_DIR"
npm run build

# 8. PM2
echo "⚡ Configurando PM2..."
cd "$APP_DIR"

# Para processo anterior se existir
pm2 delete "$PM2_NAME" 2>/dev/null || true

# Inicia API
pm2 start apps/api/dist/index.js --name "$PM2_NAME" --env production

# Salva configuração PM2
pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo "──────────────────────────────────────────"
echo "✅ DEPLOY CONCLUÍDO!"
echo "   API:      http://187.127.21.208:3002"
echo "   PM2:      pm2 logs $PM2_NAME"
echo "   Webhook:  http://187.127.21.208:3002/api/webhooks/zapi"
echo "──────────────────────────────────────────"
pm2 status
