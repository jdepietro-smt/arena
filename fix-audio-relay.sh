#!/bin/bash
# Deploy SRT audio relay — run once as root from /opt/arena
# Moves mediamtx SRT to port 8892, puts FFmpeg relay on 8890 to
# transcode PCM->AAC before mediamtx sees the stream.
set -e
CONF=/etc/mediamtx.yml
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Installing relay script ==="
cp "$DIR/srt-audio-relay.sh" /opt/arena/srt-audio-relay.sh
chmod +x /opt/arena/srt-audio-relay.sh

echo "=== Installing systemd unit ==="
cp "$DIR/arena-srt-relay.service" /etc/systemd/system/arena-srt-relay.service
systemctl daemon-reload

echo "=== Moving mediamtx SRT from :8890 to :8892 ==="
# Change or add srtAddress
if grep -q '^srtAddress:' "$CONF"; then
  sed -i 's/^srtAddress:.*/srtAddress: :8892/' "$CONF"
else
  echo 'srtAddress: :8892' >> "$CONF"
fi
echo "mediamtx will listen for SRT on :8892 (internal)"

echo "=== Opening firewall for port 8892 (SRT viewers) ==="
ufw allow 8892/udp comment 'SRT viewer' 2>/dev/null || true

echo "=== Restarting mediamtx ==="
systemctl restart mediamtx
sleep 3
systemctl is-active --quiet mediamtx && echo "mediamtx: OK on :8892" || { echo "mediamtx FAILED"; journalctl -u mediamtx -n 20 --no-pager; exit 1; }

echo "=== Starting SRT audio relay on :8890 ==="
systemctl enable --now arena-srt-relay
sleep 3
systemctl is-active --quiet arena-srt-relay && echo "arena-srt-relay: OK on :8890" || { echo "relay FAILED"; journalctl -u arena-srt-relay -n 20 --no-pager; exit 1; }

echo "=== Restarting arena ==="
systemctl restart arena
sleep 2
systemctl is-active --quiet arena && echo "arena: OK" || echo "arena: FAILED"

echo ""
echo "=== Done ==="
echo "Flow: encoder:SRT -> :8890(FFmpeg,PCM->AAC) -> :8892(mediamtx) -> WebRTC/HLS"
echo "SRT viewer URL: srt://5.78.236.254:8892?streamid=read:Golf_Channel"
