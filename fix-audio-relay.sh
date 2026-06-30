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

echo "=== Reverting mediamtx srtAddress to :8890 (undo previous edits) ==="
# Remove any srtAddress lines we may have added, restore the original port.
# mediamtx was working fine on 8890 — the relay now sits on 8895 instead.
sed -i '/srtAddress/d' "$CONF"
echo 'srtAddress: :8890' >> "$CONF"
echo "Current srtAddress lines:"
grep 'srtAddress' "$CONF"

echo "=== Restarting mediamtx ==="
systemctl stop mediamtx 2>/dev/null || true
sleep 2
systemctl start mediamtx
sleep 3
systemctl is-active --quiet mediamtx && echo "mediamtx: OK" || {
  echo "mediamtx FAILED:"
  journalctl -u mediamtx -n 20 --no-pager
  exit 1
}

echo "=== Starting SRT audio relay on :8895 ==="
systemctl stop arena-srt-relay 2>/dev/null || true
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
echo "=== Port check (8890=mediamtx SRT, 8895=relay listener) ==="
ss -ulnp | grep -E '8890|8895' || echo "(no binds yet)"

echo ""
echo "Done."
echo "ACTION REQUIRED: In arena_stream.exe, change the SRT publish"
echo "port from 8890 to 8895. The relay will transcode audio and"
echo "push into mediamtx on 8890."
