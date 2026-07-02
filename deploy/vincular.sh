#!/bin/bash
# Vincular WhatsApp por CÓDIGO (recomendado en AWS VPS)
# Uso: ./deploy/vincular.sh
set -e
cd "$(dirname "$0")/.."

echo "========================================================"
echo "  VINCULAR WHATSAPP — MODO CÓDIGO"
echo "========================================================"

sudo systemctl stop wabot 2>/dev/null || true
pkill -f "node index.js" 2>/dev/null || true

echo "[1/4] Borrando sesión anterior..."
rm -rf .wwebjs_auth .wwebjs_cache

echo "[2/4] Archivo .env..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "      Creado .env desde plantilla."
fi

# Asegurar LOGIN_MODE=code
if grep -q '^LOGIN_MODE=' .env; then
    sed -i 's/^LOGIN_MODE=.*/LOGIN_MODE=code/' .env
else
    echo 'LOGIN_MODE=code' >> .env
fi

# Quitar WA_PHONE vacío/comentado si quedó mal
CURRENT_PHONE=$(grep '^WA_PHONE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)

if [ -z "$CURRENT_PHONE" ] || [ "$CURRENT_PHONE" = "5210000000000" ]; then
    echo ""
    echo "  ⚠️  Edita .env y pon tu número en WA_PHONE"
    echo "      Ejemplo: WA_PHONE=5212281234567"
    echo ""
    read -r -p "  Número (sin + ni espacios): " INPUT_PHONE
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
    echo "      WA_PHONE=${INPUT_PHONE} guardado."
fi

echo "[3/4] Dependencias..."
chmod +x start.sh setup.sh deploy/*.sh 2>/dev/null || true
if [ ! -d "node_modules" ]; then
    npm install
fi

echo "[4/4] Iniciando bot..."
echo ""
echo "  Cuando aparezca el CÓDIGO DE 8 LETRAS:"
echo "  WhatsApp → Dispositivos vinculados → Vincular con número"
echo ""
exec ./start.sh
