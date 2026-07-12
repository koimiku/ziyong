@echo off
cd /d "%~dp0"
title anime 手机服务
echo 正在启动 anime 手机服务（局域网可访问）...
echo 默认端口: 47890
echo.
set HOST=0.0.0.0
set ANIME_PORT=47890
call npm start
if errorlevel 1 (
  echo.
  echo 启动失败。请先运行: npm install
  pause
)
