#!/bin/bash
echo "=== Services ==="
systemctl is-active mediamtx arena arena-srt-relay 2>/dev/null | paste - - - | awk '{print "mediamtx:"$1" arena:"$2" srt-relay:"$3}'

echo ""
echo "=== Ports listening ==="
ss -ulnp | grep -E '8890|8892|8889|8888' | awk '{print $5, $NF}'

echo ""
echo "=== SRT relay log (last 10) ==="
journalctl -u arena-srt-relay -n 10 --no-pager 2>/dev/null | tail -10

echo ""
echo "=== mediamtx streams ==="
curl -s localhost:9997/v3/paths/list 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for p in d.get('items',[]):
    print(p['name'],'ready:',p.get('ready'),'tracks:',len((p.get('tracks') or [])))
" 2>/dev/null || echo "(no streams)"
