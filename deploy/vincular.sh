#!/bin/bash
# Vincular WhatsApp por QR (el modo CÓDIGO está roto en WhatsApp Web actual → error "t: t")
# Uso: ./deploy/vincular.sh
set -e
cd "$(dirname "$0")/.."

echo "========================================================"
echo "  VINCULAR WHATSAPP — MODO QR"
echo "========================================================"
echo "  (El código de 8 letras está roto en WA Web;"
echo "   se usa QR en terminal — igual de válido)"
echo "========================================================"

UNLOCK_HASH="220a227688e246af1e0fb6fca4c233e0f647afeba862e406f4ee7e6795a5eae4"
hash_of() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

UNLOCK=$(grep '^SYSTEM_UNLOCK_CODE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
if [ "$(hash_of "$UNLOCK")" != "$UNLOCK_HASH" ]; then
    echo ""
    read -r -s -p "🔒 Código de desbloqueo del sistema: " INPUT_UNLOCK
    echo ""
    if [ "$(hash_of "$INPUT_UNLOCK")" != "$UNLOCK_HASH" ]; then
        echo "[ERROR] Código incorrecto. Vinculación cancelada."
        exit 1
    fi
    if [ -f ".env" ]; then
        if grep -q '^SYSTEM_UNLOCK_CODE=' .env; then
            sed -i "s/^SYSTEM_UNLOCK_CODE=.*/SYSTEM_UNLOCK_CODE=${INPUT_UNLOCK}/" .env
        else
            echo "SYSTEM_UNLOCK_CODE=${INPUT_UNLOCK}" >> .env
        fi
    fi
fi

echo "[1/5] Detener bot / Chrome..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true
sudo systemctl stop wabot 2>/dev/null || true
pkill -9 -f "node index.js" 2>/dev/null || true
pkill -9 -f chrome 2>/dev/null || true
sleep 2

echo "[2/5] Borrando sesión rota y caché..."
rm -rf .wwebjs_auth .wwebjs_cache
mkdir -p .wwebjs_cache

echo "[3/5] Archivo .env..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "      Creado .env desde plantilla."
fi

# QR obligatorio para vincular (pairing code falla con "t: t")
if grep -q '^LOGIN_MODE=' .env; then
    sed -i 's/^LOGIN_MODE=.*/LOGIN_MODE=qr/' .env
else
    echo 'LOGIN_MODE=qr' >> .env
fi

# Quitar pin WA viejo
if grep -q '^WA_WEB_VERSION=' .env; then
    sed -i 's/^WA_WEB_VERSION=.*/# WA_WEB_VERSION=/' .env
fi

CURRENT_PHONE=$(grep '^WA_PHONE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
if [ -z "$CURRENT_PHONE" ] || [ "$CURRENT_PHONE" = "5210000000000" ]; then
    echo ""
    read -r -p "  Número del bot (sin + ni espacios): " INPUT_PHONE
    INPUT_PHONE=$(echo "$INPUT_PHONE" | tr -d '+ -()')
    if [ -z "$INPUT_PHONE" ]; then
        echo "[ERROR] Número vacío. Abortando."
        exit 1
    fi
    if grep -q '^WA_PHONE=' .env; then
        sed -i "s/^WA_PHONE=.*/WA_PHONE=${INPUT_PHONE}/" .env
    else
        echo "WA_PHONE=${INPUT_PHONE}" >> .env
    fi
fi

echo "[4/5] Dependencias..."
chmod +x start.sh setup.sh deploy/*.sh 2>/dev/null || true
if [ ! -d "node_modules" ]; then
    npm install
fi

echo "[5/5] Iniciando — VA A SALIR UN QR EN LA TERMINAL"
echo ""
echo "  En el celular del bot:"
echo "  WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo"
echo "  → Escanea el QR que aparece abajo"
echo ""
echo "  Cuando diga: ✅ Logueo Exitoso  →  Ctrl+C"
echo "  Luego:  pm2 start index.js --name bot-ventas && pm2 save"
echo ""
exec ./start.sh
