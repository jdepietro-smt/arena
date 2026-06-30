#!/bin/bash
set -e
CONF=/etc/mediamtx.yml
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Ensuring relay script is executable ==="
chmod +x "$DIR/srt-audio-relay.sh"

echo "=== Installing systemd unit ==="
sed "s|ExecStart=.*|ExecStart=$DIR/srt-audio-relay.sh|" \
  "$DIR/arena-srt-relay.service" > /etc/systemd/system/arena-srt-relay.service
systemctl daemon-reload

echo "=== Setting mediamtx SRT port to :8892 (removing duplicates) ==="
sed -i '/srtAddress/d' "$CONF"
echo 'srtAddress: :8892' >> "$CONF"
grep 'srtAddress' "$CONF"

echo "=== Restarting mediamtx ==="
systemctl restart mediamtx
sleep 3
systemctl is-active --quiet mediamtx && echo "mediamtx: OK" || {
  echo "mediamtx FAILED:"
  journalctl -u mediamtx -n 20 --no-pager
  exit 1
}

echo "=== Starting SRT audio relay on :8890 ==="
systemctl enable --now arena-srt-relay
sleep 3
systemctl is-active --quiet arena-srt-relay && echo "arena-srt-relay: OK" || {
  echo "relay FAILED:"
  journalctl -u arena-srt-relay -n 20 --no-pager
  exit 1
}

echo "=== Restarting arena ==="
systemctl restart arena

echo ""
echo "=== Port check ==="
ss -ulnp | awk '{print $5}' | grep -E '8890|8892' || echo "(waiting for encoder to connect)"

echo ""
echo "Done. Stop/Start the stream in arena_stream to reconnect to the new relay."
