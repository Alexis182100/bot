#!/bin/bash
# Reparación definitiva del arranque (Chrome roto / bucle PM2)
# Uso: cd ~/bot && chmod +x deploy/reparar-arranque.sh && ./deploy/reparar-arranque.sh
set -e
cd "$(dirname "$0")/.."

echo "========================================================"
echo "  REPARAR ARRANQUE — BOT WHATSAPP"
echo "========================================================"

echo "[1/6] Detener PM2 y procesos Chrome..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true
pm2 kill 2>/dev/null || true
sleep 2
pkill -9 -f 'chrome' 2>/dev/null || true
pkill -9 -f 'chromium' 2>/dev/null || true
pkill -9 -f 'node index.js' 2>/dev/null || true
sleep 3

echo "[2/6] Liberar locks de sesión (NO borra la vinculación)..."
find .wwebjs_auth -name 'Singleton*' -delete 2>/dev/null || true
find .wwebjs_auth -name 'lockfile' -delete 2>/dev/null || true
find .wwebjs_auth -name '*.lock' -delete 2>/dev/null || true

echo "[3/6] Regenerar caché de WhatsApp Web (suele causar 'Execution context was destroyed')..."
rm -rf .wwebjs_cache
mkdir -p .wwebjs_cache

echo "[4/6] Verificar Chrome Puppeteer..."
CHROME=$(find "$HOME/.cache/puppeteer/chrome" -name chrome -type f 2>/dev/null | head -1 || true)
if [ -z "$CHROME" ]; then
    echo "      Instalando Chrome..."
    npx puppeteer browsers install chrome
fi

echo "[5/6] Limpiar logs viejos de PM2..."
rm -f "$HOME/.pm2/logs/bot-ventas-"*.log 2>/dev/null || true

echo "[6/6] Arrancar con reinicios lentos (evita el bucle)..."
pm2 start index.js --name bot-ventas \
  --max-memory-restart 900M \
  --restart-delay 20000 \
  --max-restarts 5 \
  --exp-backoff-restart-delay 3000
pm2 save

echo ""
echo "✅ Listo. Espera 1–2 minutos y revisa:"
echo "   pm2 status"
echo "   pm2 logs bot-ventas --lines 40"
echo ""
echo "Debes ver:  ✅ Logueo Exitoso"
echo "========================================================"
pm2 logs bot-ventas --lines 40
