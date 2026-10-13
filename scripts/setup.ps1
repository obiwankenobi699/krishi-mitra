# Native dev setup for Windows (no Docker, no WSL required).
# Run:  pnpm run setup:windows   (or: powershell -ExecutionPolicy Bypass -File scripts/setup.ps1)
$ErrorActionPreference = "Stop"
$ROOT = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $ROOT

# mise manages the toolchain (node, pnpm, python, uv — see mise.toml).
# Bootstrap it when missing so a fresh laptop needs nothing preinstalled.
if (-not (Get-Command "mise" -ErrorAction SilentlyContinue)) {
  Write-Host "==> Installing mise (toolchain manager)"
  try {
    winget install --silent --accept-source-agreements --accept-package-agreements jdx.mise
  } catch {
    Write-Host "mise install failed — install manually (https://mise.run), restart shell, re-run." -ForegroundColor Red
    exit 1
  }
}
$env:PATH = "$env:USERPROFILE\.local\share\mise\shims;" + $env:PATH
if (-not (Get-Command "mise" -ErrorAction SilentlyContinue)) {
  Write-Host "mise installed but not on PATH — restart your shell and re-run." -ForegroundColor Red
  exit 1
}

Write-Host "==> Checking .env"
if (-not (Test-Path ".env")) {
  Write-Host "Missing .env. Copy and fill it first:" -ForegroundColor Red
  Write-Host "  Copy-Item .env.example .env"
  exit 1
}

Write-Host "==> Toolchain via mise (node, pnpm, python, uv)"
mise trust 2>$null | Out-Null
mise install

function Need-Cmd($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "MISSING: $cmd  ($hint)" -ForegroundColor Yellow
    $script:missing += $cmd
  } else {
    Write-Host "OK: $cmd"
  }
}
$script:missing = @()
Need-Cmd "node" "mise should provide this — restart shell if just installed"
Need-Cmd "pnpm" "mise should provide this — restart shell if just installed"
Need-Cmd "uv" "mise should provide this — restart shell if just installed"
Need-Cmd "ollama" "winget install Ollama.Ollama (native app, GPU out of the box)"
Need-Cmd "tesseract" "winget install UB-Mannheim.TesseractOCR (OCR for RAG ingestion)"
Need-Cmd "ffmpeg" "winget install Gyan.FFmpeg (audio/video helpers)"
if (-not (Get-Command "pdftoppm" -ErrorAction SilentlyContinue)) {
  Write-Host "MISSING: pdftoppm (poppler)  ->  install via 'choco install poppler' or download poppler for Windows" -ForegroundColor Yellow
  $script:missing += "pdftoppm"
} else { Write-Host "OK: pdftoppm" }
if ($script:missing.Count -gt 0) { Write-Host "Install the missing tools above, then re-run." -ForegroundColor Red; exit 1 }

Write-Host "==> JS modules (pnpm install)"
pnpm install

Write-Host "==> Python deps — ONE shared venv (uv sync)"
uv sync

Write-Host "==> Local state dirs"
New-Item -ItemType Directory -Force -Path ".local/chroma_db", ".local/models", ".local/logs" | Out-Null

Write-Host "==> Vosk offline STT model (~50MB, one-time)"
if (-not (Test-Path ".local/vosk-model")) {
  Invoke-WebRequest -Uri "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip" -OutFile "$env:TEMP/vosk.zip"
  Expand-Archive -Path "$env:TEMP/vosk.zip" -DestinationPath "$env:TEMP" -Force
  Move-Item "$env:TEMP/vosk-model-small-en-us-0.15" ".local/vosk-model"
  Remove-Item "$env:TEMP/vosk.zip"
}

# Read model names from .env (fallback defaults); local: tags are never pulled
$llm = "local:disabled"; $vis = "local:yolo11x-plant"
foreach ($line in (Get-Content ".env")) {
  if ($line -match "^LOCAL_LLM_MODEL=(.+)$") { $llm = $Matches[1].Trim() }
  if ($line -match "^VISION_MODEL=(.+)$") { $vis = $Matches[1].Trim() }
}
Write-Host "==> Ollama models (native, GPU; local: tags are never pulled)"
foreach ($model in @($llm, $vis)) {
  if ($model -like "local:*" -or $model -eq "") { Write-Host "==> $model is local — skipping Ollama pull"; continue }
  ollama pull $model
}

Write-Host "==> Smoke test: boot fast services, prove health, shut down"
$portsBusy = @(8000, 8003) | Where-Object {
  Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
}
if ($portsBusy.Count -gt 0) {
  Write-Host "    (ports busy — stack already running, skipping smoke boot)"
} else {
  $env:PYTHONPATH = "$ROOT/services"
  $smokeJobs = @()
  foreach ($spec in @(@("platform_api", 8000), @("fieldscout_ai", 8003))) {
    $svcDir = $spec[0]; $port = $spec[1]
    $smokeJobs += Start-Job -Name "smoke-$svcDir" -ScriptBlock {
      param($root, $py, $dir, $port)
      $env:PYTHONPATH = "$root/services"
      Set-Location "$root/services/$dir"
      & $py -m uvicorn app.main:app --host 127.0.0.1 --port $port
    } -ArgumentList $ROOT, "$ROOT/.venv/Scripts/python.exe", $svcDir, $port
  }
  $smokeOk = $true
  foreach ($spec in @(@("platform_api", 8000), @("fieldscout_ai", 8003))) {
    $svcDir = $spec[0]; $port = $spec[1]
    $ready = $false
    for ($i = 0; $i -lt 25; $i++) {
      try { Invoke-WebRequest -Uri "http://localhost:$port/health" -TimeoutSec 2 -UseBasicParsing | Out-Null; $ready = $true; break }
      catch { Start-Sleep 2 }
    }
    if ($ready) { Write-Host "    OK: $svcDir :$port healthy" } else { Write-Host "    FAIL: $svcDir :$port failed" -ForegroundColor Red; $smokeOk = $false }
  }
  $smokeJobs | Stop-Job -ErrorAction SilentlyContinue
  $smokeJobs | Remove-Job -ErrorAction SilentlyContinue
  if (-not $smokeOk) { Write-Host "Smoke test failed — fix the services above, then re-run setup." -ForegroundColor Red; exit 1 }
  Write-Host "    (groundtruth/yieldwise warm their embedding models on first 'pnpm run dev:windows')"
}

Write-Host ""
Write-Host "Setup complete. Start everything with:  pnpm run dev:windows" -ForegroundColor Green
Write-Host "UI only:                                pnpm run web:dev"
