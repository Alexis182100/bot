#!/bin/bash
set -e
clear
echo "========================================================"
echo "  INSTALADOR AWS UBUNTU — BOT WHATSAPP"
echo "========================================================"

echo "[1/5] Paquetes del sistema..."
sudo apt update -y

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

echo "[2/5] yt-dlp (para .tt / .ig — .play desactivado en VPS)..."
python3 -m pip install -U pip --break-system-packages 2>/dev/null || python3 -m pip install -U pip
python3 -m pip install -U yt-dlp yt-dlp-ejs --break-system-packages 2>/dev/null \
    || python3 -m pip install -U yt-dlp yt-dlp-ejs

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
echo "[EXTRA] Swap (recomendado en VPS de 2GB)..."
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
HAS_SWAP=$(free -m | awk '/^Swap:/{print $2}')
if [ "$TOTAL_RAM_MB" -le 2500 ] && [ "$HAS_SWAP" -eq 0 ]; then
    echo "[INFO] VPS con ${TOTAL_RAM_MB}MB RAM y sin swap — creando 1GB de swap..."
    if sudo fallocate -l 1G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 2>/dev/null; then
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
        echo "[OK] Swap de 1GB activo."
    else
        echo "[AVISO] No se pudo crear swap."
    fi
else
    echo "[OK] Swap existente o RAM suficiente."
fi

echo ""
echo "========================================================"
echo "  INSTALACIÓN COMPLETA"
echo "========================================================"
echo "  1. Edita .env (SYSTEM_UNLOCK_CODE, ADMIN_PRIVILEGIADO, WA_PHONE)"
echo "  2. Vincula: ./deploy/vincular.sh"
echo "  3. Inicia: ./start.sh  o  pm2 start index.js --name bot"
echo "========================================================"
