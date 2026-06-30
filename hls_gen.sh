#!/bin/bash
# mediamtx runOnReady hook: generates HLS segments for a stream.
# Called by mediamtx as: /opt/arena/hls_gen.sh <stream_path>
# Runs as a background process per live stream; mediamtx restarts it if it exits.

PATH_NAME="$1"

if [ -z "$PATH_NAME" ]; then
    echo "hls_gen.sh: no stream path given" >&2
    exit 1
fi

HLS_DIR="/tmp/arena-hls/$PATH_NAME"
mkdir -p "$HLS_DIR" || { echo "hls_gen.sh: cannot create $HLS_DIR" >&2; exit 1; }

echo "hls_gen.sh: starting HLS for $PATH_NAME -> $HLS_DIR" >&2

# Video-only HLS (no audio — avoids failures on video-only SRT streams).
# Forces keyframes every 30 frames (1s at 30fps) so each 1-second segment
# can close properly without waiting for a natural keyframe.
exec ffmpeg \
    -hide_banner \
    -loglevel warning \
    -fflags nobuffer \
    -i "srt://localhost:8890?streamid=read:${PATH_NAME}&mode=caller&latency=200000" \
    -map 0:v:0 \
    -c:v libx264 \
    -preset ultrafast \
    -tune zerolatency \
    -g 30 \
    -keyint_min 30 \
    -sc_threshold 0 \
    -hls_time 1 \
    -hls_list_size 6 \
    -hls_flags delete_segments+omit_endlist \
    -f hls \
    "$HLS_DIR/index.m3u8"
