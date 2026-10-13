# Doctor (Windows twin): fresh-laptop audit. Read-only, installs nothing.
# Run:  powershell -ExecutionPolicy Bypass -File scripts/doctor.ps1
$ErrorActionPreference = "Continue"
$ROOT = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $ROOT
$env:PATH = "$env:USERPROFILE\.local\share\mise\shims;" + $env:PATH

$script:pass = 0; $script:fail = 0
function Ok($m) { Write-Host "  OK: $m"; $script:pass++ }
function Bad($m, $hint) { Write-Host "  FAIL: $m" -ForegroundColor Red; Write-Host "     fix: $hint"; $script:fail++ }
function Warn($m) { Write-Host "  WARN: $m" -ForegroundColor Yellow }
function Has($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "==> toolchain (mise.toml pins)"
if (Has "mise") { Ok "mise present" } else { Bad "mise missing" "winget install jdx.mise, restart shell" }
foreach ($t in @("node", "pnpm", "uv", "python")) {
  if (Has $t) { Ok "$t present" } else { Bad "$t missing" "mise install" }
}
if (Test-Path ".venv/Scripts/python.exe") { Ok "root .venv present" } else { Bad "root .venv missing" "pnpm run setup:windows" }

Write-Host "==> system binaries"
foreach ($t in @("ollama", "tesseract", "ffmpeg")) {
  if (Has $t) { Ok "$t present" } else { Bad "$t missing" "winget (see setup.ps1)" }
}
if (Has "pdftoppm") { Ok "pdftoppm present" } else { Bad "pdftoppm missing" "choco install poppler or manual install" }

Write-Host "==> gpu"
try {
  $vram = (nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1).Trim()
  Ok "NVIDIA GPU ${vram}MiB total"
  if ([int]$vram -ge 6000) { Write-Host "     tier: performance" } else { Write-Host "     tier: efficient" }
} catch { Bad "no NVIDIA GPU visible" "CPU-only unsupported (REQUIRE_GPU=1)" }
if (Test-Path ".local/models/yolo11-plant/plantvillage_yolo11x.onnx") { Ok "YOLO weights staged" } else { Bad "YOLO weights missing" "see services/fieldscout_ai/README.md" }

Write-Host "==> configuration (.env values never printed)"
if (-not (Test-Path ".env")) { Bad ".env missing" "Copy-Item .env.example .env and fill values" }
foreach ($k in @("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SECRET_KEY", "INTERNAL_API_KEY", "NEXT_PUBLIC_SUPABASE_URL")) {
  $hit = $false
  foreach ($line in (Get-Content ".env" -ErrorAction SilentlyContinue)) {
    if ($line -match "^\s*$k=(.+)$" -and $Matches[1].Trim() -ne "") { $hit = $true }
  }
  if ($hit) { Ok "$k set" } else { Bad "$k empty" "fill it in .env" }
}
if (Select-String -Quiet -Pattern "REPLACE_ME" ".env" -ErrorAction SilentlyContinue) { Warn "SUPABASE_DB_URL still placeholder (price training degraded)" }

Write-Host "==> ports (busy is fine if dev is running)"
foreach ($p in @(3000, 8000, 8001, 8002, 8003, 11434)) {
  if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { Write-Host "     :$p busy" }
  else { Write-Host "     :$p free" }
}

Write-Host ""
Write-Host "RESULT: $($script:pass) pass, $($script:fail) fail"
if ($script:fail -gt 0) { exit 1 }
