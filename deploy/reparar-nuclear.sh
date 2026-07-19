#!/bin/bash
# REPARACIÓN NUCLEAR — mata todo, limpia locks/caché, arranca el bot
# Uso: cd ~/bot && bash deploy/reparar-nuclear.sh
set -e
cd "$(dirname "$0")/.."

echo "========================================================"
echo "  REPARACIÓN NUCLEAR — BOT WHATSAPP"
echo "========================================================"

echo "[1/7] Matar PM2, Node y Chrome (forzado)..."
pm2 kill 2>/dev/null || true
sleep 1
killall -9 node 2>/dev/null || true
killall -9 chrome 2>/dev/null || true
killall -9 chromium 2>/dev/null || true
killall -9 chromium-browser 2>/dev/null || true
pkill -9 -f 'puppeteer' 2>/dev/null || true
pkill -9 -f 'whatsapp' 2>/dev/null || true
pkill -9 -f 'index.js' 2>/dev/null || true
sleep 3

# Por si quedó algún chrome zombie
ps aux | grep -E '[c]hrome|[c]hromium|[n]ode index' | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
sleep 2

echo "[2/7] Liberar memoria /tmp de Chrome..."
rm -rf /tmp/.org.chromium.* /tmp/.com.google.Chrome* /tmp/puppeteer_dev_chrome_profile-* 2>/dev/null || true
rm -rf /tmp/chrome_* 2>/dev/null || true

echo "[3/7] Liberar locks de sesión (NO borra vinculación)..."
if [ -d .wwebjs_auth ]; then
  find .wwebjs_auth -name 'Singleton*' -delete 2>/dev/null || true
  find .wwebjs_auth -name 'lockfile' -delete 2>/dev/null || true
  find .wwebjs_auth -name '*.lock' -delete 2>/dev/null || true
  find .wwebjs_auth -name 'DevToolsActivePort' -delete 2>/dev/null || true
fi

echo "[4/7] Regenerar caché WA Web (causa típica del crash)..."
rm -rf .wwebjs_cache
mkdir -p .wwebjs_cache

echo "[5/7] Asegurar Chrome Puppeteer..."
CHROME=$(find "$HOME/.cache/puppeteer/chrome" -name chrome -type f 2>/dev/null | head -1 || true)
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "      Reinstalando Chrome..."
  npx puppeteer browsers install chrome || true
fi

echo "[6/7] Actualizar código..."
git fetch origin cursor/fase1-estabilidad 2>/dev/null || true
git pull origin cursor/fase1-estabilidad || true

echo "[7/7] Arrancar bot limpio..."
rm -f "$HOME/.pm2/logs/bot-ventas-"*.log 2>/dev/null || true
mkdir -p "$HOME/.pm2/logs"
pm2 start index.js --name bot-ventas \
  --max-memory-restart 900M \
  --restart-delay 25000 \
  --max-restarts 8 \
  --exp-backoff-restart-delay 5000
pm2 save

echo ""
echo "========================================================"
echo "  ESPERA 2 MINUTOS SIN TOCAR NADA"
echo "  Luego:  pm2 status"
echo "  Luego:  pm2 logs bot-ventas --lines 40"
echo "  Buscas: ✅ Logueo Exitoso"
echo "========================================================"
sleep 8
pm2 status
pm2 logs bot-ventas --lines 25 --nostream || true
