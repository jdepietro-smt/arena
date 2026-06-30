#!/bin/bash
# Configure mediamtx for WebRTC/WHEP preview.
# Requires ports 8889 TCP and 8889 UDP open inbound.
# Run as root: bash fix-webrtc.sh
set -e

CONF=/etc/mediamtx.yml

echo "=== Detecting public IP ==="
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || \
            curl -s --max-time 5 icanhazip.com 2>/dev/null || echo "")
if [ -z "$PUBLIC_IP" ]; then
    echo "ERROR: could not auto-detect public IP."
    echo "Run: PUBLIC_IP=x.x.x.x bash fix-webrtc.sh"
    exit 1
fi
echo "Public IP: $PUBLIC_IP"

echo ""
echo "=== Updating mediamtx WebRTC config ==="

python3 - << PYEOF
import re, sys

CONF = '/etc/mediamtx.yml'
PUBLIC_IP = '$PUBLIC_IP'
text = open(CONF).read()

def upsert(text, key, val):
    """Set key: val, or add it right after webrtcAddress line."""
    pat = rf'^{key}:.*'
    new = f'{key}: {val}'
    if re.search(pat, text, re.MULTILINE):
        return re.sub(pat, new, text, flags=re.MULTILINE)
    return text.replace('webrtcAddress: :8889',
                        f'webrtcAddress: :8889\n{new}', 1)

# Pin WebRTC media to UDP port 8889 — avoids opening a random ephemeral range.
text = upsert(text, 'webrtcICEUDPMuxAddress', ':8889')

# Advertise public IP in ICE candidates so the browser can reach the server.
text = upsert(text, 'webrtcAdditionalHosts', f'[{PUBLIC_IP}]')

# Allow cross-origin requests from the ArenaHub browser app.
text = upsert(text, 'webrtcAllowOrigin', "'*'")

open(CONF, 'w').write(text)
print('Done.')
PYEOF

echo ""
echo "=== mediamtx WebRTC config ==="
grep -E 'webrtcAddress|webrtcICEUDP|webrtcAdditional|webrtcAllow' "$CONF"

echo ""
echo "=== Restarting mediamtx ==="
systemctl restart mediamtx
sleep 3
if systemctl is-active --quiet mediamtx; then
    echo "mediamtx: OK"
else
    echo "mediamtx: FAILED"
    journalctl -u mediamtx -n 25 --no-pager
    exit 1
fi

echo ""
echo "=== Test WHEP endpoint (expect 404 if no stream live, not connection refused) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST http://localhost:8889/test/whep \
  -H 'Content-Type: application/sdp' \
  --data '' || echo "(curl failed — check mediamtx is listening on 8889)"
