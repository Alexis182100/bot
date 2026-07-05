#!/bin/bash
# Configura bypass de YouTube en VPS (Cloudflare WARP + PO Token para yt-dlp)
# Uso: ./deploy/setup-youtube-bypass.sh
set -e

echo "========================================================"
echo "  BYPASS YOUTUBE — WARP + PO Token (.play en VPS)"
echo "========================================================"

BOT_USER="${SUDO_USER:-$USER}"
BOT_HOME="$(getent passwd "$BOT_USER" | cut -d: -f6)"
POT_DIR="${BOT_HOME}/bgutil-ytdlp-pot-provider"
POT_VERSION="${POT_VERSION:-1.3.1}"
POT_PORT="${YT_DLP_POT_PORT:-4416}"

install_warp() {
    if command -v warp-cli &>/dev/null; then
        echo "[WARP] Ya instalado."
    else
        echo "[WARP] Instalando Cloudflare WARP..."
        curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
        echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list >/dev/null
        sudo apt update -y
        sudo apt install -y cloudflare-warp
    fi

    if ! sudo warp-cli registration show 2>/dev/null | grep -q "Account type"; then
        echo "[WARP] Registrando dispositivo (gratis)..."
        sudo warp-cli registration new || true
    fi

    sudo warp-cli set-mode warp 2>/dev/null || true
    sudo warp-cli connect 2>/dev/null || true

    if sudo warp-cli status 2>/dev/null | grep -qi "connected"; then
        echo "[OK] WARP conectado — tráfico sale por IP de Cloudflare."
    else
        echo "[AVISO] WARP instalado pero no conectado. Ejecuta: sudo warp-cli connect"
    fi
}

install_pot_plugin() {
    echo "[POT] Instalando plugin bgutil para yt-dlp..."
    python3 -m pip install -U "bgutil-ytdlp-pot-provider>=1.3.0" --break-system-packages 2>/dev/null \
        || python3 -m pip install -U "bgutil-ytdlp-pot-provider>=1.3.0"
}

install_pot_server() {
    echo "[POT] Instalando servidor PO Token (puerto ${POT_PORT})..."

    if command -v docker &>/dev/null; then
        if docker ps -a --format '{{.Names}}' | grep -qx bgutil-provider; then
            docker start bgutil-provider 2>/dev/null || true
            echo "[OK] Contenedor bgutil-provider ya existe."
        else
            docker run --name bgutil-provider -d --restart unless-stopped \
                -p "127.0.0.1:${POT_PORT}:4416" \
                brainicism/bgutil-ytdlp-pot-provider:latest
            echo "[OK] Servidor PO Token en Docker (127.0.0.1:${POT_PORT})."
        fi
        return
    fi

    if [ ! -d "$POT_DIR/.git" ]; then
        sudo -u "$BOT_USER" git clone --depth 1 --branch "$POT_VERSION" \
            https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$POT_DIR"
    fi

    echo "[POT] Compilando servidor Node..."
    sudo -u "$BOT_USER" bash -c "cd '$POT_DIR/server' && npm ci && npx tsc"

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    sed -e "s|@BOT_USER@|${BOT_USER}|g" \
        -e "s|@BOT_HOME@|${BOT_HOME}|g" \
        -e "s|@POT_PORT@|${POT_PORT}|g" \
        "$SCRIPT_DIR/ytdlp-pot.service" | sudo tee /etc/systemd/system/ytdlp-pot.service >/dev/null

    sudo systemctl daemon-reload
    sudo systemctl enable ytdlp-pot
    sudo systemctl restart ytdlp-pot

    sleep 2
    if curl -fsS "http://127.0.0.1:${POT_PORT}/" >/dev/null 2>&1 || systemctl is-active ytdlp-pot &>/dev/null; then
        echo "[OK] Servidor PO Token nativo (systemd: ytdlp-pot)."
    else
        echo "[AVISO] Servidor PO Token puede no estar listo. Revisa: sudo systemctl status ytdlp-pot"
    fi
}

configure_env() {
    local env_file="${BOT_HOME}/bot/.env"
    [ -f "$env_file" ] || env_file="$(pwd)/.env"
    [ -f "$env_file" ] || return 0

    grep -q '^YT_DLP_POT_PROVIDER_URL=' "$env_file" 2>/dev/null || \
        echo "YT_DLP_POT_PROVIDER_URL=http://127.0.0.1:${POT_PORT}" >> "$env_file"

    grep -q '^YT_DLP_FORCE_IPV4=' "$env_file" 2>/dev/null || \
        echo "YT_DLP_FORCE_IPV4=true" >> "$env_file"

    echo "[OK] Variables añadidas a .env (YT_DLP_POT_PROVIDER_URL, YT_DLP_FORCE_IPV4)."
}

install_warp
install_pot_plugin
install_pot_server
configure_env

echo ""
echo "========================================================"
echo "  BYPASS YOUTUBE LISTO"
echo "========================================================"
echo "  WARP:     sudo warp-cli status"
echo "  PO Token: curl http://127.0.0.1:${POT_PORT}/  (o docker ps)"
echo "  Probar:   yt-dlp -v 'https://youtube.com/watch?v=Jkj36B1YuDU' -f ba -x --audio-format mp3"
echo "========================================================"
