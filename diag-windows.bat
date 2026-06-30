@echo off
echo === Ports listening on this machine ===
netstat -an | findstr "LISTENING" | findstr ":4200\|:8890\|:8891\|:9997"

echo.
echo === Active SRT connections ===
netstat -an | findstr ":8890\|:4200"

echo.
echo === Testing read from localhost:8890 ===
ffmpeg -hide_banner -loglevel error -t 3 -i "srt://127.0.0.1:8890?streamid=read:Golf_Channel&mode=caller" -f null - 2>&1 | head -3
echo (exit: %errorlevel%)

echo.
echo === Testing read from localhost:4200 ===
ffmpeg -hide_banner -loglevel error -t 3 -i "srt://127.0.0.1:4200" -f null - 2>&1 | head -3
echo (exit: %errorlevel%)

pause
