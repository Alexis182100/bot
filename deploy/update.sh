#!/bin/bash
# Actualizar bot en VPS (conserva sesión y .env) y reiniciar automáticamente
set -e
cd "$(dirname "$0")/.."

echo "========================================================"
echo "  ACTUALIZAR BOT"
echo "========================================================"

WAS_ACTIVE=0
if systemctl is-active --quiet wabot 2>/dev/null; then
    WAS_ACTIVE=1
fi

sudo systemctl stop wabot 2>/dev/null || true
pkill -f "node index.js" 2>/dev/null || true

git pull origin main
npm install
chmod +x start.sh setup.sh deploy/*.sh 2>/dev/null || true

if [ "$WAS_ACTIVE" = "1" ] || systemctl list-unit-files 2>/dev/null | grep -q '^wabot.service'; then
    echo ""
    echo "🔄 Reiniciando servicio wabot..."
    sudo systemctl start wabot
    sleep 3
    if systemctl is-active --quiet wabot; then
        echo "✅ Bot actualizado y corriendo."
        echo "   Logs: sudo journalctl -u wabot -f"
    else
        echo "⚠️ El servicio no arrancó. Revisa: sudo journalctl -u wabot -n 50"
    fi
else
    echo ""
    echo "✅ Actualizado. Inicia con:"
    echo "   ./start.sh"
    echo "   o: sudo systemctl start wabot"
fi
echo "========================================================"
