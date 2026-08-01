#!/bin/bash
# ArenaHub single-box installer — sets up the full stack (mediamtx + backend
# + frontend) on a fresh Ubuntu box: system packages, mediamtx binary +
# config + systemd unit, Python venv + backend, frontend build, .env, and
# the arena systemd unit. Run as root on the target box.
#
# Usage:
#   sudo bash install.sh <server-ip> [install-dir]
#
#   server-ip    Public or LAN IP this box is reachable at — needed for
#                WebRTC ICE candidates (mediamtx's webrtcAdditionalHosts)
#                to resolve correctly from a viewer off-box.
#   install-dir  Defaults to /opt/arena. Must be this repo's checkout (the
#                script operates on the directory it's run from unless a
#                different one is given).
#
# NOT yet validated end-to-end on a truly fresh box — written from the
# existing manual deploy process (deploy.sh, restore-mediamtx.sh) plus a
# full survey of what those scripts assume already exists. Review each
# step against your target box before trusting it unattended, especially
# the mediamtx binary download and the systemd unit paths.
set -euo pipefail

MEDIAMTX_VERSION="v1.19.2"   # matches patches/mediamtx_production — see patches/README.md

SERVER_IP="${1:-}"
if [ -z "$SERVER_IP" ]; then
    echo "Usage: sudo bash install.sh <server-ip> [install-dir]" >&2
    exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${2:-$REPO_DIR}"
VENV="$INSTALL_DIR/venv"

if [ "$EUID" -ne 0 ]; then
    echo "Run as root (sudo bash install.sh ...)." >&2
    exit 1
fi

echo "=== ArenaHub install: server_ip=$SERVER_IP install_dir=$INSTALL_DIR ==="

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------
echo "--- Installing system packages ---"
apt-get update -qq
apt-get install -y python3-venv python3-pip ffmpeg curl tar

if ! command -v node >/dev/null 2>&1 || [ "$(node --version | sed 's/^v//' | cut -d. -f1)" -lt 18 ]; then
    echo "ERROR: Node.js 18+ is required to build the frontend but wasn't found." >&2
    echo "Install it first (e.g. via nodesource: https://github.com/nodesource/distributions)," >&2
    echo "then re-run this script." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. mediamtx: binary + config + systemd unit
# ---------------------------------------------------------------------------
if [ ! -x /usr/local/bin/mediamtx ]; then
    echo "--- Installing mediamtx $MEDIAMTX_VERSION ---"
    TMP_TGZ="$(mktemp)"
    curl -fL -o "$TMP_TGZ" \
        "https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz"
    tar -xzf "$TMP_TGZ" -C /usr/local/bin mediamtx
    rm -f "$TMP_TGZ"
    chmod +x /usr/local/bin/mediamtx
else
    echo "--- mediamtx already installed at /usr/local/bin/mediamtx, skipping download ---"
fi

echo "--- Writing /etc/mediamtx.yml ---"
sed "s/__SERVER_IP__/$SERVER_IP/g" "$REPO_DIR/deploy/mediamtx.yml.template" > /etc/mediamtx.yml

echo "--- Installing mediamtx.service ---"
cp "$REPO_DIR/deploy/mediamtx.service" /etc/systemd/system/mediamtx.service

# ---------------------------------------------------------------------------
# 3. Backend: venv + deps
# ---------------------------------------------------------------------------
echo "--- Setting up Python venv ---"
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q -r "$INSTALL_DIR/backend/requirements.txt"

# ---------------------------------------------------------------------------
# 4. .env — generated once; re-running the installer does NOT overwrite an
#    existing one, so a real SECRET_KEY/SRT passphrase already in place
#    survives a re-install.
# ---------------------------------------------------------------------------
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "--- Generating .env ---"
    SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
    cat > "$ENV_FILE" << EOF
MEDIAMTX_API=http://localhost:9997
MEDIAMTX_HLS=http://localhost:8888
MEDIAMTX_WEBRTC=http://localhost:8889
MEDIAMTX_SRT_PORT=8890
SRT_PUBLISH_PASSPHRASE=
SECRET_KEY=$SECRET_KEY
DATABASE_URL=sqlite:///./arena.db
SERVER_IP=$SERVER_IP
ARENA_PORT=8001
ALERT_WEBHOOK_URL=
# The dashboard is served by this same app, so browser requests are
# same-origin and don't need CORS at all. Only add an origin here if you're
# running a separately-hosted frontend against this API.
CORS_ORIGINS=http://localhost:5173
EOF
    echo "    Generated a random SECRET_KEY."
    echo "    SRT_PUBLISH_PASSPHRASE is blank — the SRT publish port is open to"
    echo "    anyone who can reach it until you set one (10-79 chars) and restart."
else
    echo "--- .env already exists, leaving it alone ---"
fi

# ---------------------------------------------------------------------------
# 5. Frontend build
# ---------------------------------------------------------------------------
echo "--- Building frontend ---"
(cd "$INSTALL_DIR/frontend" && npm ci --silent && npm run build --silent)

# ---------------------------------------------------------------------------
# 6. arena.service
# ---------------------------------------------------------------------------
echo "--- Installing arena.service ---"
sed -e "s#__INSTALL_DIR__#$INSTALL_DIR#g" -e "s/__ARENA_PORT__/8001/g" \
    "$REPO_DIR/deploy/arena.service.template" > /etc/systemd/system/arena.service

# ---------------------------------------------------------------------------
# 7. Enable + start
# ---------------------------------------------------------------------------
echo "--- Starting services ---"
systemctl daemon-reload
systemctl enable mediamtx arena
systemctl restart mediamtx
sleep 2
systemctl restart arena
sleep 2

systemctl is-active --quiet mediamtx && echo "mediamtx: OK" || {
    echo "mediamtx FAILED — check: journalctl -u mediamtx -n 40 --no-pager" >&2
}
systemctl is-active --quiet arena && echo "arena: OK" || {
    echo "arena FAILED — check: journalctl -u arena -n 40 --no-pager" >&2
}

echo ""
echo "=== Done ==="
echo "ArenaHub: http://$SERVER_IP:8001"
echo "Default login: admin / admin123 — change this immediately (Settings > Users)."
echo ""
echo "Still to do manually:"
echo "  1. Set SRT_PUBLISH_PASSPHRASE in $ENV_FILE (10-79 chars), then: systemctl restart arena"
echo "  2. Open firewall ports if needed: 8001/tcp (dashboard), 8890/udp (SRT),"
echo "     8889/tcp+udp (WebRTC), 8888/tcp (HLS), 9997/tcp (mediamtx API, LAN-only recommended)"
echo "  3. Change the default admin password"
