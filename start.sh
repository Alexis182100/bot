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

echo "[1/6] Dependencias npm..."
if [ ! -d "node_modules" ]; then
    npm install
fi

echo "[2/6] Archivo .env..."
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "[AVISO] Creado .env — edita BOT_L2_CODE, ADMIN_PRIVILEGIADO y WA_PHONE"
fi

if [ ! -f ".env" ]; then
    echo "[AVISO] Sin .env — el bot usará valores por defecto de index.js"
fi

if [ -f ".env" ]; then
    LOGIN_MODE=$(grep '^LOGIN_MODE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || echo "code")
    WA_PHONE=$(grep '^WA_PHONE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
    if [ "$LOGIN_MODE" = "code" ] && { [ -z "$WA_PHONE" ] || [ "$WA_PHONE" = "5210000000000" ]; }; then
        echo "[ERROR] Configura WA_PHONE en .env o ejecuta: ./deploy/vincular.sh"
        exit 1
    fi
fi

# Código de desbloqueo del sistema (seguridad anti-uso no autorizado)
UNLOCK=$(grep '^SYSTEM_UNLOCK_CODE=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
if [ -z "$UNLOCK" ]; then
    echo ""
    echo "🔒 SISTEMA BLOQUEADO — se requiere código de desbloqueo"
    read -r -s -p "   Código (no se muestra al escribir): " UNLOCK
    echo ""
    if grep -q '^SYSTEM_UNLOCK_CODE=' .env 2>/dev/null; then
        sed -i "s/^SYSTEM_UNLOCK_CODE=.*/SYSTEM_UNLOCK_CODE=${UNLOCK}/" .env
    else
        echo "SYSTEM_UNLOCK_CODE=${UNLOCK}" >> .env
    fi
fi

echo "[3/6] Chrome Puppeteer..."
CHROME_CACHE="$HOME/.cache/puppeteer/chrome"
if [ ! -d "$CHROME_CACHE" ] || [ -z "$(find "$CHROME_CACHE" -name chrome -type f 2>/dev/null | head -1)" ]; then
    echo "[INFO] Instalando Chrome..."
    npx puppeteer browsers install chrome || {
        echo "[ERROR] Chrome no instalado."
        echo "        Ejecuta: ./setup.sh"
        echo "        O manual: npx puppeteer browsers install chrome"
        exit 1
    }
fi

echo "[4/6] Herramientas multimedia..."
MISSING=""
command -v ffmpeg &>/dev/null || MISSING="${MISSING}ffmpeg "
command -v yt-dlp &>/dev/null || MISSING="${MISSING}yt-dlp "
if [ -n "$MISSING" ]; then
    echo "[AVISO] Faltan: $MISSING — .play/.yt pueden fallar."
    echo "        Instala con: ./setup.sh"
fi

echo "[5/6] YouTube bypass (.play en VPS)..."
POT_URL="${YT_DLP_POT_PROVIDER_URL:-http://127.0.0.1:4416}"
if ! curl -fsS --max-time 2 "$POT_URL" >/dev/null 2>&1; then
    if systemctl is-active ytdlp-pot &>/dev/null; then
        echo "[OK] Servidor PO Token (systemd: ytdlp-pot)."
    elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qx bgutil-provider; then
        echo "[OK] Servidor PO Token (Docker: bgutil-provider)."
    else
        echo "[AVISO] PO Token no responde en $POT_URL"
        echo "        Ejecuta: ./deploy/setup-youtube-bypass.sh"
    fi
fi
if command -v warp-cli &>/dev/null; then
    if sudo warp-cli status 2>/dev/null | grep -qi "connected"; then
        echo "[OK] Cloudflare WARP conectado."
    else
        echo "[AVISO] WARP instalado pero no conectado. Prueba: sudo warp-cli connect"
    fi
fi

echo "[6/6] Iniciando bot..."
exec node index.js
