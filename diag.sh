#!/bin/bash
# Arena HLS diagnostic — run on server via VNC:
#   bash /opt/arena/diag.sh 2>&1 | head -80
echo "=== SERVICES ==="
systemctl is-active mediamtx arena || true
ss -tlnp | grep -E '8001|8888|8890|9997' || echo "no matching ports"

echo ""
echo "=== MEDIAMTX HLS CONFIG ==="
grep -i hls /etc/mediamtx.yml

echo ""
echo "=== STREAM STATUS (mediamtx API) ==="
curl -s localhost:9997/v3/paths/list | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d.get('items', []):
    print('path:', p.get('name'), '| ready:', p.get('ready'), '| source:', p.get('source', {}).get('type'))
" 2>/dev/null || echo "mediamtx API unreachable"

echo ""
echo "=== MEDIAMTX HLS DIRECT (port 8888) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" localhost:8888/Golf_Channel/index.m3u8
curl -sL localhost:8888/Golf_Channel/index.m3u8 | head -8

echo ""
echo "=== ARENA PROXY (port 8001) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" localhost:8001/api/hls/Golf_Channel/index.m3u8
curl -sL localhost:8001/api/hls/Golf_Channel/index.m3u8 | head -8

echo ""
echo "=== ARENA LOG (last 15 lines) ==="
journalctl -u arena -n 15 --no-pager

echo ""
echo "=== MEDIAMTX LOG (last 10 lines) ==="
journalctl -u mediamtx -n 10 --no-pager
