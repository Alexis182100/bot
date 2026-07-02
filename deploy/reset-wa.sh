#!/bin/bash
# Limpia sesión WhatsApp y reinicia el bot (VPS)
set -e
cd "$(dirname "$0")/.."

echo "Deteniendo bot si corre con systemd..."
sudo systemctl stop wabot 2>/dev/null || true

echo "Borrando sesión y caché WhatsApp..."
rm -rf .wwebjs_auth .wwebjs_cache

echo ""
echo "Listo. Para vincular de nuevo:"
echo ""
echo "  Opción A — Código (más fiable en VPS):"
echo "    1. Edita .env y descomenta WA_PHONE=521XXXXXXXXXX"
echo "    2. ./start.sh"
echo "    3. En el teléfono: WhatsApp → Dispositivos vinculados → Vincular con número"
echo ""
echo "  Opción B — QR:"
echo "    1. ./start.sh"
echo "    2. Escanea el QR en cuanto aparezca (expira ~20s)"
echo ""
