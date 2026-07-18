#!/bin/bash
# Instala Bot desde GitHub en Ubuntu/VPS
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/Alexis182100/bot/main/deploy/install.sh | bash
#   ./deploy/install.sh
#   ./deploy/install.sh --code MI_CODIGO --admin 7209143300 --start

set -e

REPO_URL="${REPO_URL:-https://github.com/Alexis182100/bot.git}"
INSTALL_DIR="${INSTALL_DIR:-bot}"
BRANCH="${BRANCH:-main}"
AUTO_START=false
BOT_L2_CODE=""
ADMIN_PRIVILEGIADO=""

usage() {
    cat <<'EOF'
Uso: install.sh [opciones]

Opciones:
  --dir PATH          Carpeta de instalación (default: bot)
  --repo URL          Repositorio git (default: GitHub Alexis182100/bot)
  --branch NAME       Rama a clonar (default: main)
  --code CODIGO       BOT_L2_CODE para .env
  --admin NUMERO      ADMIN_PRIVILEGIADO para .env
  --start             Inicia el bot al terminar (./start.sh)
  -h, --help          Muestra esta ayuda

Variables de entorno (alternativa a flags):
  INSTALL_DIR, REPO_URL, BRANCH, BOT_L2_CODE, ADMIN_PRIVILEGIADO

Ejemplos:
  ./deploy/install.sh
  ./deploy/install.sh --code MI_CODIGO --admin 7209143300 --start
  BOT_L2_CODE=MI_CODIGO ADMIN_PRIVILEGIADO=521XXXXXXXXXX ./deploy/install.sh --start
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir) INSTALL_DIR="$2"; shift 2 ;;
        --repo) REPO_URL="$2"; shift 2 ;;
        --branch) BRANCH="$2"; shift 2 ;;
        --code) BOT_L2_CODE="$2"; shift 2 ;;
        --admin) ADMIN_PRIVILEGIADO="$2"; shift 2 ;;
        --start) AUTO_START=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Opción desconocida: $1"; usage; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

is_bot_repo() {
    [[ -f "$1/index.js" && -f "$1/setup.sh" && -f "$1/package.json" ]]
}

configure_env() {
    local dir="$1"

    if [[ ! -f "$dir/.env.example" ]]; then
        echo "[ERROR] No existe .env.example en $dir"
        exit 1
    fi

    if [[ ! -f "$dir/.env" ]]; then
        cp "$dir/.env.example" "$dir/.env"
        echo "[OK] Creado .env desde .env.example"
    else
        echo "[INFO] .env ya existe — se actualizarán solo valores vacíos o de ejemplo"
    fi

    if [[ -z "$BOT_L2_CODE" ]]; then
        read -r -s -p "BOT_L2_CODE (vacío = usar el interno del sistema): " BOT_L2_CODE
        echo ""
    fi

    if [[ -z "$ADMIN_PRIVILEGIADO" ]]; then
        read -r -p "ADMIN_PRIVILEGIADO [7209143300]: " ADMIN_PRIVILEGIADO
        ADMIN_PRIVILEGIADO="${ADMIN_PRIVILEGIADO:-7209143300}"
    fi

    if [[ -n "$BOT_L2_CODE" ]]; then
        if grep -q '^#\? *BOT_L2_CODE=' "$dir/.env"; then
            sed -i "s/^#\? *BOT_L2_CODE=.*/BOT_L2_CODE=${BOT_L2_CODE}/" "$dir/.env"
        else
            echo "BOT_L2_CODE=${BOT_L2_CODE}" >> "$dir/.env"
        fi
    fi
    sed -i "s/^ADMIN_PRIVILEGIADO=.*/ADMIN_PRIVILEGIADO=${ADMIN_PRIVILEGIADO}/" "$dir/.env"

    echo "[OK] .env configurado (los códigos no se muestran)"
    echo "     ADMIN_PRIVILEGIADO=${ADMIN_PRIVILEGIADO}"
}

echo "========================================================"
echo "  INSTALADOR — BOT (GitHub)"
echo "========================================================"

TARGET_DIR=""

if is_bot_repo "$ROOT_DIR" && [[ "$(basename "$ROOT_DIR")" != "deploy" ]]; then
    echo "[INFO] Ya estás en el repositorio del bot."
    TARGET_DIR="$ROOT_DIR"
elif [[ -d "$INSTALL_DIR" ]] && is_bot_repo "$INSTALL_DIR"; then
    echo "[INFO] Carpeta '$INSTALL_DIR' ya existe — actualizando..."
    cd "$INSTALL_DIR"
    git pull origin "$BRANCH" || git pull
    TARGET_DIR="$(pwd)"
else
    echo "[1/4] Clonando $REPO_URL ..."
    if ! command -v git &>/dev/null; then
        echo "[INFO] Instalando git..."
        sudo apt update -y
        sudo apt install -y git
    fi
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
    TARGET_DIR="$(cd "$INSTALL_DIR" && pwd)"
fi

cd "$TARGET_DIR"
echo "[2/4] Ejecutando setup.sh ..."
chmod +x setup.sh start.sh deploy/install.sh 2>/dev/null || true
./setup.sh

echo "[3/4] Configurando .env ..."
configure_env "$TARGET_DIR"

echo ""
echo "========================================================"
echo "  INSTALACIÓN LISTA"
echo "========================================================"
echo "  Carpeta: $TARGET_DIR"
echo "  Iniciar:  cd $TARGET_DIR && ./start.sh"
echo "  Systemd:  sudo cp deploy/wabot.service /etc/systemd/system/"
echo "            sudo systemctl daemon-reload && sudo systemctl enable wabot"
echo "            sudo systemctl start wabot"
echo "========================================================"

if [[ "$AUTO_START" == true ]]; then
    echo "[4/4] Iniciando bot..."
    exec ./start.sh
else
    read -r -p "¿Iniciar el bot ahora? [s/N]: " START_NOW
    if [[ "$START_NOW" =~ ^[sSyY]$ ]]; then
        exec ./start.sh
    fi
    echo "Listo. Cuando quieras: cd $TARGET_DIR && ./start.sh"
fi
