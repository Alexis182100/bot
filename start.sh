#!/bin/bash
clear
echo "========================================================"
echo "  INFINITY BOT — WhatsApp"
echo "========================================================"

if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js no instalado. Ejecuta: ./setup.sh"
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "[ERROR] Se requiere Node.js 18+. Actual: $(node -v)"
    exit 1
fi

echo "[1/5] Dependencias npm..."
if [ ! -d "node_modules" ]; then
    npm install
fi

echo "[2/5] Archivo .env..."
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "[AVISO] Creado .env — edita WA_PHONE y ejecuta ./deploy/vincular.sh"
fi

if [ -f ".env" ]; then
    LOGIN_MODE=$(grep '^LOGIN_MODE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || echo "code")
    WA_PHONE=$(grep '^WA_PHONE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
    if [ "$LOGIN_MODE" = "code" ] && { [ -z "$WA_PHONE" ] || [ "$WA_PHONE" = "5210000000000" ]; }; then
        echo "[ERROR] Configura WA_PHONE en .env o ejecuta: ./deploy/vincular.sh"
        exit 1
    fi
fi

echo "[3/5] Chrome Puppeteer..."
CHROME_CACHE="$HOME/.cache/puppeteer/chrome"
if [ ! -d "$CHROME_CACHE" ] || [ -z "$(find "$CHROME_CACHE" -name chrome -type f 2>/dev/null | head -1)" ]; then
    echo "[INFO] Instalando Chrome..."
    npx puppeteer browsers install chrome || {
        echo "[ERROR] Chrome no instalado. Ejecuta: ./setup.sh"
        exit 1
    }
fi

echo "[4/5] Herramientas multimedia..."
MISSING=""
command -v ffmpeg &>/dev/null || MISSING="${MISSING}ffmpeg "
command -v yt-dlp &>/dev/null || MISSING="${MISSING}yt-dlp "
if [ -n "$MISSING" ]; then
    echo "[AVISO] Faltan: $MISSING — .play/.yt pueden fallar."
    echo "        Instala con: ./setup.sh"
fi

echo "[5/5] Iniciando bot..."
exec node index.js
