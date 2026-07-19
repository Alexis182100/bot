#!/bin/bash
# REPARACIÓN DEFINITIVA — mata todo, borra pin WA viejo, arranca con WA en vivo
set -e
cd "$(dirname "$0")/.."

echo "========================================================"
echo "  REPARACIÓN DEFINITIVA — BOT WHATSAPP"
echo "========================================================"

echo "[1/8] Matar TODO (PM2 / Node / Chrome)..."
pm2 kill 2>/dev/null || true
sleep 1
killall -9 node 2>/dev/null || true
killall -9 chrome 2>/dev/null || true
killall -9 chromium 2>/dev/null || true
pkill -9 -f 'puppeteer|index.js|whatsapp' 2>/dev/null || true
sleep 3
ps aux | grep -E '[c]hrome|[c]hromium|[n]ode' | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
sleep 2

echo "[2/8] Limpiar /tmp de Chrome..."
rm -rf /tmp/.org.chromium.* /tmp/.com.google.Chrome* /tmp/puppeteer_dev_chrome_profile-* 2>/dev/null || true

echo "[3/8] Liberar locks de sesión (NO borra vinculación)..."
if [ -d .wwebjs_auth ]; then
  find .wwebjs_auth -name 'Singleton*' -delete 2>/dev/null || true
  find .wwebjs_auth -name 'lockfile' -delete 2>/dev/null || true
  find .wwebjs_auth -name '*.lock' -delete 2>/dev/null || true
  find .wwebjs_auth -name 'DevToolsActivePort' -delete 2>/dev/null || true
fi

echo "[4/8] BORRAR pin viejo de WhatsApp Web (causa del crash)..."
rm -rf .wwebjs_cache
mkdir -p .wwebjs_cache

echo "[5/8] Quitar WA_WEB_VERSION del .env si existe (forzar WA en vivo)..."
if [ -f .env ] && grep -q '^WA_WEB_VERSION=' .env; then
  sed -i 's/^WA_WEB_VERSION=.*/# WA_WEB_VERSION=/' .env
  echo "      WA_WEB_VERSION desactivado en .env"
fi

echo "[6/8] Actualizar código..."
git fetch origin cursor/fase1-estabilidad 2>/dev/null || true
git pull origin cursor/fase1-estabilidad || true

echo "[7/8] Verificar Chrome..."
CHROME=$(find "$HOME/.cache/puppeteer/chrome" -name chrome -type f 2>/dev/null | head -1 || true)
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  npx puppeteer browsers install chrome || true
fi

echo "[8/8] Arrancar bot..."
rm -f "$HOME/.pm2/logs/bot-ventas-"*.log 2>/dev/null || true
pm2 start index.js --name bot-ventas \
  --max-memory-restart 900M \
  --restart-delay 25000 \
  --max-restarts 5
pm2 save

echo ""
echo "========================================================"
echo "  ESPERA 2 MINUTOS. Buscas:"
echo "   🌐 WA Web en vivo"
echo "   🔐 Sesión WhatsApp encontrada  (o código si hay que vincular)"
echo "   ✅ Logueo Exitoso"
echo ""
echo "  Si NO enciende:  ./deploy/vincular.sh"
echo "========================================================"
sleep 10
pm2 status
pm2 logs bot-ventas --lines 30 --nostream || true
