#!/bin/bash
# Arena deploy script — runs on the server (5.78.236.254)
# Usage: bash deploy.sh
set -e

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$DEPLOY_DIR/venv"

echo "=== Arena Deploy ==="

# 1. Install system deps
apt-get install -y python3-venv python3-pip 2>/dev/null || true

# 2. Python venv + deps (frontend dist/ is pre-built in the repo)
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q -r "$DEPLOY_DIR/backend/requirements.txt"

# 5. Write systemd service
cat > /etc/systemd/system/arena.service << EOF
[Unit]
Description=Arena API
After=network.target

[Service]
WorkingDirectory=$DEPLOY_DIR
ExecStart=$VENV/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8001 --workers 2
Restart=always
RestartSec=5
Environment=PYTHONPATH=$DEPLOY_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable arena
systemctl restart arena

echo "=== Arena running on :8001 ==="
echo "=== Default login: admin / admin123 ==="
