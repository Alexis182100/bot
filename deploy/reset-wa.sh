#!/bin/bash
# Borra sesión WhatsApp. Para volver a vincular usa: ./deploy/vincular.sh
set -e
cd "$(dirname "$0")/.."

sudo systemctl stop wabot 2>/dev/null || true
pkill -f "node index.js" 2>/dev/null || true
rm -rf .wwebjs_auth .wwebjs_cache

echo "✅ Sesión borrada."
echo "   Vincular de nuevo: ./deploy/vincular.sh"
