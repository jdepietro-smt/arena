#!/bin/bash
# Audio diagnostic — run as: bash /opt/arena/diag-audio.sh Golf_Channel
PATH_NAME="${1:-Golf_Channel}"

echo "=== mediamtx path info ==="
curl -s localhost:9997/v3/paths/get/$PATH_NAME 2>/dev/null | python3 -m json.tool 2>/dev/null || \
  curl -s localhost:9997/v3/paths/get/$PATH_NAME

echo ""
echo "=== mediamtx recent logs (audio/codec) ==="
journalctl -u mediamtx -n 100 --no-pager 2>/dev/null | grep -iE 'audio|opus|aac|codec|track' | tail -20

echo ""
echo "=== stream codec (5s probe) ==="
timeout 5 ffprobe -v error -show_streams \
  "srt://localhost:8890?streamid=read:${PATH_NAME}&mode=caller&timeout=4000000" 2>&1 \
  | grep -E 'codec_name|channels|sample_rate|codec_type' || echo "(no response — stream may be offline)"
