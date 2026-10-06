@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

call npm run dist
if errorlevel 1 (
  echo.
  echo 打包失败，请查看上面的错误信息。
  pause
  exit /b %errorlevel%
)

echo.
echo 打包完成：%~dp0release-1.2.7\小丸工具箱-1.2.7.exe
pause
