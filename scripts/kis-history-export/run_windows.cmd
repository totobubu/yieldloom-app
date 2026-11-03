@echo off
chcp 65001 >nul
set PYTHONUTF8=1
where py >nul 2>&1
if errorlevel 1 (
  python "%~dp0export_history.py" %*
) else (
  py -3 "%~dp0export_history.py" %*
)
echo.
pause
