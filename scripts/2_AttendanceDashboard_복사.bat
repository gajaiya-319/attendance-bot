@echo off
chcp 65001 >nul
set "SRC=C:\Users\hyun yong\OneDrive\Desktop\AttendanceDashboard.html.txt"

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (!(Test-Path -LiteralPath '%SRC%')) { Write-Host 'ERROR: AttendanceDashboard.html.txt not found.'; exit 1 }; Get-Content -LiteralPath '%SRC%' -Raw -Encoding UTF8 | Set-Clipboard; Write-Host 'OK: AttendanceDashboard.html copied to clipboard.'"

if errorlevel 1 (
  echo Copy failed. Check AttendanceDashboard.html.txt on Desktop.
) else (
  echo Copied. Open Apps Script AttendanceDashboard.html, then press Ctrl+A and Ctrl+V.
)
pause
