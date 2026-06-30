#!/bin/bash
# Nuclear reset: stops everything, writes a verified clean mediamtx config,
# restarts all services, and reports status clearly.
set -e

echo "========================================"
echo " ARENA FULL RESET"
echo "========================================"

echo ""
echo "--- Stopping all services ---"
systemctl stop arena-srt-relay 2>/dev/null || true
systemctl stop arena 2>/dev/null || true
systemctl stop mediamtx 2>/dev/null || true
sleep 2

echo "--- Killing anything still on relevant ports ---"
for port in 8888 8889 8890 8891 8892 8895; do
  fuser -k ${port}/udp 2>/dev/null || true
  fuser -k ${port}/tcp 2>/dev/null || true
done
sleep 1

echo "--- Writing clean mediamtx.yml ---"
python3 - << 'PYEOF'
config = """\
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
encryption: 'no'
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
hlsSegmentMaxSize: 50MB
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
"""
with open('/etc/mediamtx.yml', 'w') as f:
    f.write(config)
print("mediamtx.yml written OK")
PYEOF

echo "--- Starting mediamtx ---"
systemctl start mediamtx
sleep 4

if systemctl is-active --quiet mediamtx; then
  echo "mediamtx: RUNNING"
else
  echo "mediamtx: FAILED - last 25 log lines:"
  journalctl -u mediamtx -n 25 --no-pager
  exit 1
fi

echo "--- Starting arena ---"
systemctl start arena
sleep 3

if systemctl is-active --quiet arena; then
  echo "arena: RUNNING"
else
  echo "arena: FAILED - last 15 log lines:"
  journalctl -u arena -n 15 --no-pager
  exit 1
fi

echo ""
echo "--- Listening ports ---"
ss -tulnp | grep -E '8888|8889|8890|9997' || echo "(none found)"

echo ""
echo "--- mediamtx stream list ---"
sleep 1
curl -s http://localhost:9997/v3/paths/list | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('items', [])
if not items:
    print('  (no streams — encoder not connected)')
for p in items:
    print(f\"  {p['name']}  ready={p.get('ready')}  source={p.get('source',{}).get('type','?')}\")
" 2>/dev/null || echo "  (API not responding yet)"

echo ""
echo "========================================"
echo " DONE"
echo " Encoder (arena_stream.exe) must publish"
echo " SRT to 5.78.236.254:8890"
echo " Stop/Start stream in arena_stream.exe"
echo " to force reconnect."
echo "========================================"
