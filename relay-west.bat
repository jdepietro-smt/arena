@echo off
setlocal
title RELAY WEST — Golf Channel

:: arena_stream listens on 4200 when RELAY WEST is active (blank=listener in UI)
:: FFmpeg reads from that listener, transcodes PCM audio -> AAC, pushes to server
set SOURCE=srt://127.0.0.1:4200
set DEST=srt://5.78.236.254:8890?streamid=publish:Golf_Channel^&mode=caller^&latency=200000

echo.
echo  RELAY WEST  Golf Channel
echo  Reading from arena_stream port 4200 (PCM) -^> Server (AAC)
echo.
echo  Make sure RELAY WEST is ACTIVE in arena_stream before running this.
echo  Press Ctrl+C to stop.
echo.

:loop
ffmpeg -hide_banner -loglevel warning ^
  -i "%SOURCE%" ^
  -c:v copy ^
  -c:a aac -b:a 192k -ar 48000 ^
  -f mpegts "%DEST%"

echo  [relay stopped — restarting in 3s...]
timeout /t 3 /nobreak >nul
goto loop
