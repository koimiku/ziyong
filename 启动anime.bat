@echo off
cd /d "%~dp0"
title anime
echo 正在启动 anime 桌面版...
echo 默认端口: 47890（避免与旧版 5173 冲突）
echo.
call npm run app
if errorlevel 1 (
  echo.
  echo 启动失败。请先运行: npm install
  pause
)
