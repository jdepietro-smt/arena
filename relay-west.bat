@echo off
setlocal
title RELAY WEST — Golf Channel

set SOURCE=srt://127.0.0.1:8890?streamid=read:Golf_Channel^&mode=caller^&latency=200000
set DEST=srt://5.78.236.254:8890?streamid=publish:Golf_Channel^&mode=caller^&latency=200000

echo.
echo  RELAY WEST  Golf Channel
echo  Local mediamtx -^> Server with audio transcoding
echo.
echo  Press Ctrl+C to stop.
echo.

:loop
ffmpeg -hide_banner -loglevel warning ^
  -i "%SOURCE%" ^
  -c:v copy ^
  -c:a aac -b:a 192k -ar 48000 ^
  -f mpegts "%DEST%"

echo.
echo  [relay stopped — restarting in 3s...]
timeout /t 3 /nobreak >nul
goto loop
