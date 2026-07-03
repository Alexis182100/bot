#!/bin/bash
# Actualizar bot en VPS (conserva sesión y .env)
set -e
cd "$(dirname "$0")/.."

echo "========================================================"
echo "  ACTUALIZAR BOT"
echo "========================================================"

sudo systemctl stop wabot 2>/dev/null || true
pkill -f "node index.js" 2>/dev/null || true

git pull origin main
npm install
chmod +x start.sh setup.sh deploy/*.sh 2>/dev/null || true

echo ""
echo "✅ Actualizado. Inicia con:"
echo "   ./start.sh"
echo "   o: sudo systemctl start wabot"
echo "========================================================"
