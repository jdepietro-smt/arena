#!/bin/bash
# Restore a clean working mediamtx.yml and restart.
# Stops the relay, writes a known-good config, restarts mediamtx.
set -e

echo "=== Stopping services ==="
systemctl stop arena-srt-relay 2>/dev/null || true
systemctl stop mediamtx 2>/dev/null || true
sleep 2

echo "=== Writing clean mediamtx.yml ==="
cat > /etc/mediamtx.yml << 'YAMLEOF'
logLevel: info
logDestinations: [stdout]
readTimeout: 10s
writeTimeout: 10s
writeQueueSize: 512
udpMaxPayloadSize: 1472
api: yes
apiAddress: :9997
apiAllowOrigin: '*'
metrics: no
pprof: no
rtsp: yes
protocols: [multicast, tcp, udp]
rtspAddress: :8554
rtpAddress: :8000
rtcpAddress: :8001
rtmp: yes
rtmpAddress: :1935
hls: yes
hlsAddress: :8888
hlsVariant: lowLatency
hlsSegmentCount: 7
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
hlsAllowOrigin: '*'
webrtc: yes
webrtcAddress: :8889
webrtcAllowOrigin: '*'
webrtcIPsFromInterfaces: yes
webrtcAdditionalHosts: [5.78.236.254]
webrtcLocalUDPAddress: :8889
srt: yes
srtAddress: :8890
paths:
  all:
    source: publisher
YAMLEOF

echo "=== Starting mediamtx ==="
systemctl start mediamtx
sleep 3
systemctl is-active --quiet mediamtx && echo "mediamtx: OK" || {
  echo "mediamtx FAILED:"
  journalctl -u mediamtx -n 30 --no-pager
  exit 1
}

echo ""
echo "=== Port check ==="
ss -ulnp | grep -E '8890|8889|8888' || true

echo "=== Restarting arena backend ==="
systemctl restart arena
sleep 3
systemctl is-active --quiet arena && echo "arena: OK" || {
  echo "arena FAILED:"
  journalctl -u arena -n 20 --no-pager
  exit 1
}

echo ""
echo "=== Stream list from mediamtx API ==="
curl -s localhost:9997/v3/paths/list 2>/dev/null | python3 -c \
  "import sys,json; d=json.load(sys.stdin); [print(p['name'],p.get('ready')) for p in d.get('items',[])]" \
  || echo "(no streams yet)"

echo ""
echo "Done. Publish to port 8890 with arena_stream.exe."
echo "Stop/start the stream in arena_stream if it was running during this reset."
