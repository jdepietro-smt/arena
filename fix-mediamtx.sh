#!/bin/bash
# Fix mediamtx config for HLS preview and restart the service.
# Run as root: bash fix-mediamtx.sh

set -e
CONF=/etc/mediamtx.yml

# Remove Low-Latency HLS parts (causes "reached maximum segment size" crash)
sed -i '/hlsPartDuration/d' "$CONF"

# Ensure segment count is at least 7 (LL-HLS minimum, even in standard mode)
sed -i 's/hlsSegmentCount: [0-9]*/hlsSegmentCount: 7/' "$CONF"

# Remove any wrongly-cased alwaysRemux entries then add the correct one
sed -i '/hlsalwaysremux/Id' "$CONF"
if ! grep -q 'hlsAlwaysRemux' "$CONF"; then
  sed -i '/hlsSegmentCount/a hlsAlwaysRemux: yes' "$CONF"
fi

echo "=== mediamtx HLS config ==="
grep -i hls "$CONF"
echo ""

systemctl restart mediamtx
echo "Waiting for muxer to buffer segments..."
sleep 6

echo "=== HLS test ==="
curl -L -s "http://localhost:8888/Golf_Channel/index.m3u8" | head -10 \
  && echo "SUCCESS" || echo "FAILED - check: journalctl -u mediamtx -n 10"

echo ""
echo "=== Restarting arena service (loads latest Python code) ==="
systemctl restart arena
sleep 2
systemctl is-active arena && echo "arena: OK" || echo "arena: FAILED - check: journalctl -u arena -n 20"
