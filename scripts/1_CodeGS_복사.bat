@echo off
chcp 65001 >nul
set "SRC=C:\Users\hyun yong\OneDrive\Desktop\Code.gs.txt"

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (!(Test-Path -LiteralPath '%SRC%')) { Write-Host 'ERROR: Code.gs.txt not found.'; exit 1 }; Get-Content -LiteralPath '%SRC%' -Raw -Encoding UTF8 | Set-Clipboard; Write-Host 'OK: Code.gs copied to clipboard.'"

if errorlevel 1 (
  echo Copy failed. Check Code.gs.txt on Desktop.
) else (
  echo Apps Script Code.gs file: press Ctrl+A, then Ctrl+V.
)
pause
