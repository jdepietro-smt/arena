#!/bin/bash
# SRT audio relay: listens on port 8895 for the encoder's stream (PCM 24-bit),
# transcodes audio to AAC, and republishes to mediamtx on port 8890.
# mediamtx.yml is NOT touched — it stays on its original :8890.
STREAM="${STREAM_NAME:-Golf_Channel}"

exec ffmpeg -hide_banner -loglevel warning \
  -i "srt://0.0.0.0:8895?mode=listener&latency=200000" \
  -c:v copy \
  -c:a aac -b:a 192k -ar 48000 \
  -f mpegts \
  "srt://127.0.0.1:8890?streamid=publish:${STREAM}&mode=caller&latency=200000"
