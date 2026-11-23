@echo off
setlocal
rem Portable opt-in Authoring Core smoke for the released Windows Gateway.
rem Run from a trusted extracted GitHub Actions artifact. No API key in this
rem file or in browser settings. No WSL, Git, PowerShell script or Go required.
set "STUDIO_AI_GATEWAY_URL=http://127.0.0.1:8787/opencode-go/openai"
set "STUDIO_AI_MODEL_ID=deepseek-v4.1-flash"
set "STUDIO_AI_GATEWAY_TOKEN="

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required for this optional Studio smoke.
  echo Gateway itself does not require Node.js.
  exit /b 2
)
node -e "if (parseInt(process.versions.node.split('.')[0],10)<24) process.exit(1)"
if errorlevel 1 (
  echo This optional smoke requires Node.js 24 or newer.
  exit /b 2
)
if not exist "%~dp0ai-authoring-live-gateway-smoke.mjs" (
  echo Missing smoke bundle next to this launcher.
  exit /b 2
)
echo.
echo This will send ONLY a synthetic CA-SL Procedure to your local AI Gateway.
echo OpenCode Go may count this as a billable model request.
echo No workspace files, provider keys, or model responses will be logged.
echo.
choice /C YN /N /M "Run one model request? [Y/N] "
if errorlevel 2 exit /b 0
node "%~dp0ai-authoring-live-gateway-smoke.mjs"
exit /b %errorlevel%
