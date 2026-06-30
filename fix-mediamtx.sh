#!/bin/bash
# Fix mediamtx HLS — root cause: H264 stream has ~8s keyframe interval,
# mediamtx built-in HLS muxer crashes waiting for a keyframe.
# Solution: disable built-in HLS muxer, run per-stream ffmpeg HLS generator
# with forced 1s keyframes via mediamtx runOnReady hook.
# Run as root: bash fix-mediamtx.sh
set -e
CONF=/etc/mediamtx.yml

echo "=== Installing ffmpeg (HLS generator) ==="
apt-get install -y ffmpeg 2>/dev/null | grep -E 'install|already' || true

echo ""
echo "=== Disabling mediamtx built-in HLS muxer ==="
# Built-in HLS muxer requires keyframes to close segments — crashes without them.
sed -i 's/^hlsAddress:.*/hlsAddress: ""/' "$CONF"
sed -i '/hlsPartDuration/d' "$CONF"
sed -i '/hlsAlwaysRemux/Id' "$CONF"
sed -i '/hlsSegmentCount/d' "$CONF"
sed -i '/hlsSegmentDuration/d' "$CONF"

echo ""
echo "=== Adding ffmpeg HLS generator (runOnReady hook) ==="
# The hook starts an ffmpeg process per stream that:
# - Reads from mediamtx SRT as a reader (doesn't affect main stream)
# - Re-encodes video with forced 1s keyframes (fixes the segment crash)
# - Writes HLS files to /tmp/arena-hls/{stream}/
mkdir -p /tmp/arena-hls

python3 - << 'PYEOF'
import sys

CONF = '/etc/mediamtx.yml'
HOOK = r"""
  "~.*":
    runOnReady: "bash -c 'mkdir -p /tmp/arena-hls/${MTX_PATH} && ffmpeg -hide_banner -loglevel error -fflags nobuffer -i \"srt://localhost:8890?streamid=read:${MTX_PATH}&mode=caller&latency=200000\" -c:v libx264 -preset ultrafast -tune zerolatency -g 30 -keyint_min 30 -sc_threshold 0 -c:a aac -b:a 128k -hls_time 1 -hls_list_size 7 -hls_flags delete_segments+omit_endlist -f hls /tmp/arena-hls/${MTX_PATH}/index.m3u8'"
    runOnReadyRestart: yes
"""

text = open(CONF).read()

if 'runOnReady' in text:
    print('runOnReady hook already present — skipping')
    sys.exit(0)

if 'paths:' in text:
    # Insert hook rules right after the 'paths:' line
    text = text.replace('paths:', 'paths:' + HOOK, 1)
    print('Added hook to existing paths section')
else:
    text += '\npaths:' + HOOK + '\n'
    print('Added paths section with hook')

open(CONF, 'w').write(text)
PYEOF

echo ""
echo "=== mediamtx config ==="
grep -E 'hlsAddress|runOnReady|runOnReadyRestart|^paths' "$CONF" || echo "(check config manually)"

echo ""
echo "=== Restarting mediamtx ==="
systemctl restart mediamtx
sleep 4
systemctl is-active mediamtx && echo "mediamtx: OK" || echo "mediamtx: FAILED"

echo ""
echo "=== Restarting arena (loads new proxy code) ==="
systemctl restart arena
sleep 2
systemctl is-active arena && echo "arena: OK" || echo "arena: FAILED"

echo ""
echo "=== Done. Once stream is live, verify with: ==="
echo "  ls /tmp/arena-hls/Golf_Channel/"
echo "  curl -s localhost:8001/api/hls/Golf_Channel/index.m3u8 | head -5"
