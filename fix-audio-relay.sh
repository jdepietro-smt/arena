#!/bin/bash
# Deploy SRT audio relay — run once as root from /opt/arena
set -e
CONF=/etc/mediamtx.yml
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Ensuring relay script is executable ==="
chmod +x "$DIR/srt-audio-relay.sh"

echo "=== Installing systemd unit ==="
cp "$DIR/arena-srt-relay.service" /etc/systemd/system/arena-srt-relay.service
systemctl daemon-reload

echo "=== Moving mediamtx SRT from :8890 to :8892 ==="
if grep -q 'srtAddress' "$CONF"; then
  sed -i 's|srtAddress:.*|srtAddress: :8892|' "$CONF"
else
  echo 'srtAddress: :8892' >> "$CONF"
fi
grep 'srtAddress' "$CONF"

echo "=== Restarting mediamtx ==="
systemctl restart mediamtx
sleep 3
systemctl is-active --quiet mediamtx && echo "mediamtx: OK" || { echo "mediamtx FAILED"; journalctl -u mediamtx -n 20 --no-pager; exit 1; }

echo "=== Starting SRT audio relay on :8890 ==="
# Point systemd at the git repo directly (no copy needed)
sed -i "s|ExecStart=.*|ExecStart=$DIR/srt-audio-relay.sh|" /etc/systemd/system/arena-srt-relay.service
systemctl daemon-reload
systemctl enable --now arena-srt-relay
sleep 3
systemctl is-active --quiet arena-srt-relay && echo "arena-srt-relay: OK" || { echo "relay FAILED"; journalctl -u arena-srt-relay -n 30 --no-pager; exit 1; }

echo "=== Restarting arena ==="
systemctl restart arena
sleep 2
systemctl is-active --quiet arena && echo "arena: OK" || echo "arena: FAILED"

echo ""
echo "=== Port check ==="
ss -ulnp | grep -E '8890|8892'

echo ""
echo "=== Done ==="
echo "Encoder sends to :8890 (FFmpeg, PCM->AAC) -> :8892 (mediamtx)"
echo "If hub still shows no stream, stop/start the stream in arena_stream"
