@echo off
chcp 65001 >nul
title 觅字 · 酷狗歌词库
set PYTHONDONTWRITEBYTECODE=1
cd /d "%~dp0"

echo 正在启动酷狗歌词库（首次打开将自动引导扫码登录并同步歌单）…

REM 先结束旧实例：重复双击不会开出两个服务、抢两个端口
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*kg_web.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
ping -n 2 127.0.0.1 >nul

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -u kg_web.py
  goto :done
)

where python >nul 2>nul
if not errorlevel 1 (
  python -u kg_web.py
  goto :done
)

echo.
echo [未检测到 Python] 请先安装 Python 3.9 及以上版本：https://www.python.org/downloads/
echo 安装时请务必勾选 "Add Python to PATH"，安装完成后重新双击本文件即可。

:done
echo.
echo 服务已停止，按任意键关闭窗口。
pause >nul
