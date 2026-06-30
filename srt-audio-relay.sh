#!/bin/bash
# SRT audio relay: sits on port 8890, receives the encoder's SRT stream
# (which carries PCM 24-bit audio that mediamtx can't ingest), transcodes
# audio to AAC, and republishes to mediamtx on port 8892.
#
# Stream name is read from /etc/arena-relay.conf or defaults to Golf_Channel.
STREAM="${STREAM_NAME:-Golf_Channel}"

exec ffmpeg -hide_banner -loglevel warning \
  -i "srt://0.0.0.0:8890?mode=listener&latency=200000" \
  -c:v copy \
  -c:a aac -b:a 192k -ar 48000 \
  -f mpegts \
  "srt://127.0.0.1:8892?streamid=publish:${STREAM}&mode=caller&latency=200000"
