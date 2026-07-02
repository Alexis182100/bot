#!/bin/bash
set -e
clear
echo "========================================================"
echo "  INSTALADOR AWS UBUNTU — BOT WHATSAPP"
echo "========================================================"

echo "[1/5] Paquetes del sistema..."
sudo apt update -y

# Ubuntu 24.04+ renombró varios paquetes a variantes *t64
pick_apt_pkg() {
    local legacy="$1"
    local modern="$2"
    if apt-cache show "$modern" &>/dev/null; then
        echo "$modern"
    else
        echo "$legacy"
    fi
}

CHROME_DEPS=(
    curl ca-certificates gnupg
    ffmpeg python3 python3-pip
    libnss3 libdrm2
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
    libgbm1 libpango-1.0-0 libcairo2
    "$(pick_apt_pkg libatk1.0-0 libatk1.0-0t64)"
    "$(pick_apt_pkg libatk-bridge2.0-0 libatk-bridge2.0-0t64)"
    "$(pick_apt_pkg libcups2 libcups2t64)"
    "$(pick_apt_pkg libasound2 libasound2t64)"
)

sudo apt install -y "${CHROME_DEPS[@]}"

if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
    echo "[INFO] Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

echo "[2/5] yt-dlp (para .play / .yt)..."
python3 -m pip install -U pip --break-system-packages 2>/dev/null || python3 -m pip install -U pip
python3 -m pip install -U yt-dlp --break-system-packages 2>/dev/null || python3 -m pip install -U yt-dlp

echo "[3/5] Dependencias npm..."
npm install

echo "[4/5] Chrome Puppeteer..."
npx puppeteer browsers install chrome || {
    echo "[ERROR] Falló instalación de Chrome. Reintenta: npx puppeteer browsers install chrome"
    exit 1
}

echo "[5/5] Configuración..."
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo "[INFO] Creado .env — edítalo antes de producción."
fi

chmod +x start.sh 2>/dev/null || true
mkdir -p tmp data/cache data

echo ""
echo "========================================================"
echo "  INSTALACIÓN COMPLETA"
echo "========================================================"
echo "  1. Edita .env (BOT_L2_CODE, ADMIN_PRIVILEGIADO)"
echo "  2. Inicia: ./start.sh"
echo "  3. Producción con systemd:"
echo "     sudo cp deploy/wabot.service /etc/systemd/system/"
echo "     sudo systemctl daemon-reload && sudo systemctl enable wabot"
echo "     sudo systemctl start wabot"
echo "========================================================"
