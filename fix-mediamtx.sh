#!/bin/bash
# Fix mediamtx HLS — replaces brittle inline bash-in-YAML runOnReady with a
# standalone hls_gen.sh script. Run as root from the arena git directory:
#   bash fix-mediamtx.sh
set -e

CONF=/etc/mediamtx.yml
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Installing ffmpeg ==="
apt-get install -y ffmpeg 2>/dev/null | grep -E 'install|already' || true

echo ""
echo "=== Installing HLS generator script ==="
mkdir -p /opt/arena
cp "$SCRIPT_DIR/hls_gen.sh" /opt/arena/hls_gen.sh
chmod +x /opt/arena/hls_gen.sh
echo "Installed: /opt/arena/hls_gen.sh"

echo ""
echo "=== Updating mediamtx config ==="

# Remove built-in HLS muxer settings (causes crash on ~8s keyframe streams)
sed -i '/^hlsAddress/d'        "$CONF"
sed -i '/^hlsPartDuration/d'   "$CONF"
sed -i '/^hlsAlwaysRemux/Id'   "$CONF"
sed -i '/^hlsSegmentCount/d'   "$CONF"
sed -i '/^hlsSegmentDuration/d' "$CONF"

# Rebuild the paths block cleanly — remove any old hook, insert the new one.
python3 - << 'PYEOF'
import re, sys

CONF = '/etc/mediamtx.yml'
text = open(CONF).read()

# Strip old paths block entirely (old complex bash-in-YAML hook lives here)
text = re.sub(r'\npaths:.*', '', text, flags=re.DOTALL)

# Append a clean paths block — no quoting tricks, no shell escaping.
# mediamtx substitutes ${MTX_PATH} before passing the command to sh.
HOOK = """
paths:
  "~.*":
    runOnReady: /opt/arena/hls_gen.sh ${MTX_PATH}
    runOnReadyRestart: yes
"""

text = text.rstrip() + '\n' + HOOK

open(CONF, 'w').write(text)
print('Config updated — paths section rewritten')
PYEOF

echo ""
echo "=== mediamtx config (paths section) ==="
grep -A4 'paths:' "$CONF"

echo ""
echo "=== Restarting mediamtx ==="
systemctl restart mediamtx
sleep 4
if systemctl is-active --quiet mediamtx; then
    echo "mediamtx: OK"
else
    echo "mediamtx: FAILED"
    journalctl -u mediamtx -n 25 --no-pager
    exit 1
fi

echo ""
echo "=== Restarting arena ==="
systemctl restart arena
sleep 2
systemctl is-active --quiet arena && echo "arena: OK" || echo "arena: FAILED"

echo ""
echo "=== Done. Start streaming, then verify with: ==="
echo "  ls /tmp/arena-hls/"
echo "  curl -s localhost:8001/api/hls/Golf_Channel/index.m3u8 | head -5"
