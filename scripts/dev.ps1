# Native dev runner for Windows (no Docker). Ollama runs natively, DB is Supabase cloud.
# Run:  pnpm run dev:windows
# Ports: web 3000, platform_api 8000, groundtruth 8001, yieldwise 8002, fieldscout 8003.
$ErrorActionPreference = "Stop"
$ROOT = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $ROOT

# mise shims first so node/pnpm/python/uv resolve to pinned versions
$env:PATH = "$env:USERPROFILE\.local\share\mise\shims;" + $env:PATH

# Ollama can be installed per-user without its folder being on this PowerShell
# process's inherited PATH. Resolve the CLI explicitly for start/pull commands.
$ollamaExe = (Get-Command ollama -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $ollamaExe) {
  $ollamaCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:USERPROFILE "AppData\Local\Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
  )
  $ollamaExe = $ollamaCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not (Test-Path ".env")) { Write-Host "Missing .env - run: pnpm run setup:windows" -ForegroundColor Red; exit 1 }
if (-not (Test-Path ".venv/Scripts/python.exe")) { Write-Host ".venv missing - run: pnpm run setup:windows" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path ".local/chroma_db", ".local/models", ".local/logs" | Out-Null

# Load .env into process env (parity with dev.sh `source .env`; backends need the secrets)
foreach ($line in (Get-Content ".env")) {
  if ($line -match "^\s*(#|$)") { continue }
  $idx = $line.IndexOf("=")
  if ($idx -gt 0) {
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    if ($k -ne "") { Set-Item -Path ("env:" + $k) -Value $v }
  }
}

# Native overrides (Docker hostnames -> localhost)
# NOTE: forced localhost — .env carries Docker's service hostnames for compose.
$env:OLLAMA_API_BASE_URL = "http://localhost:11434"
$env:GROUNDTRUTH_URL = "http://localhost:8001"
$env:YIELDWISE_URL = "http://localhost:8002"
$env:FIELDSCOUT_URL = "http://localhost:8003"
$env:PYTHONPATH = "$ROOT/services"
$env:CHROMA_DB_PATH = "$ROOT/.local/chroma_db"
$env:MODEL_DIR = "$ROOT/.local/models"
$env:KNOWLEDGE_DOCS_DIR = "$ROOT/knowledge_documents"
$env:VOSK_MODEL_PATH = "$ROOT/.local/vosk-model"
$env:REQUIRE_GPU = "1"
if (-not $env:NEXT_PUBLIC_API_URL) { $env:NEXT_PUBLIC_API_URL = "http://localhost:8000" }

# Native HF cache: .env may point at Docker's /shared/hf_cache, so use a
# project-local cache that is writable and consistent for this Windows runner.
$hfDir = "$ROOT/.local/hf_cache"
New-Item -ItemType Directory -Force -Path $hfDir | Out-Null
$env:HF_HOME = $hfDir

# Venv CUDA/cuDNN DLLs for TensorFlow GPU discovery (passed into jobs below)
$cudaPath = ""
$nvidiaLibs = Get-ChildItem -Directory "$ROOT/.venv/Lib/site-packages/nvidia/*/lib" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
if ($nvidiaLibs) { $cudaPath = ($nvidiaLibs -join ";") }

# Single-instance guard: refuse to start if another stack holds these ports
function Test-PortInUse($port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect("127.0.0.1", $port, $null, $null)
    $connected = $iar.AsyncWaitHandle.WaitOne(500)
    if ($connected -and $c.Connected) { return $true }
    return $false
  } catch { return $false }
  finally { $c.Close() }
}
$taken = @()
foreach ($p in @(3000, 8000, 8001, 8002, 8003)) {
  if (Test-PortInUse $p) { $taken += $p }
}
# :11434 is shared with a natively-running ollama — only a conflict if it isn't ollama
if (Test-PortInUse 11434) {
  $ollamaThere = $false
  try { Invoke-WebRequest -Uri "$env:OLLAMA_API_BASE_URL/api/tags" -TimeoutSec 5 -UseBasicParsing | Out-Null; $ollamaThere = $true }
  catch {}
  if (-not $ollamaThere) { $taken += 11434 }
}
if ($taken.Count -gt 0) {
  Write-Host ("Port(s) " + ($taken -join ", ") + " already in use - stop the other stack first, then re-run.") -ForegroundColor Red
  exit 1
}

# Ollama native (VRAM guard; widened automatically on 6GB+ GPUs)
if (-not $env:OLLAMA_MAX_LOADED_MODELS) { $env:OLLAMA_MAX_LOADED_MODELS = "1" }
$VRAM_MB = 0
try {
  $vramOut = (nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1).Trim()
  $VRAM_MB = [int]$vramOut
} catch {}
if ($VRAM_MB -ge 6000) {
  if (-not $env:YOLO_PROVIDERS) { $env:YOLO_PROVIDERS = "cuda,cpu" }
  if (-not $env:OLLAMA_NUM_PARALLEL) { $env:OLLAMA_NUM_PARALLEL = "2" }
  if (-not $env:OLLAMA_KEEP_ALIVE) { $env:OLLAMA_KEEP_ALIVE = "10m" }
  Write-Host "==> GPU tier: performance (${VRAM_MB}MB VRAM — YOLO on CUDA, parallel LLM)"
} else {
  if (-not $env:YOLO_PROVIDERS) { $env:YOLO_PROVIDERS = "cpu" }
  if (-not $env:OLLAMA_NUM_PARALLEL) { $env:OLLAMA_NUM_PARALLEL = "1" }
  if (-not $env:OLLAMA_KEEP_ALIVE) { $env:OLLAMA_KEEP_ALIVE = "5m" }
  Write-Host "==> GPU tier: efficient (${VRAM_MB}MB VRAM — YOLO on CPU, sequential LLM)"
}
$ollamaUp = $false
try { Invoke-WebRequest -Uri "$env:OLLAMA_API_BASE_URL/api/tags" -TimeoutSec 5 -UseBasicParsing | Out-Null; $ollamaUp = $true }
catch {}
if (-not $ollamaUp) {
  if (-not $ollamaExe) {
    Write-Host "Ollama server is not responding and ollama.exe was not found on PATH or in $env:LOCALAPPDATA\Programs\Ollama." -ForegroundColor Red
    exit 1
  }
  Write-Host "==> Starting ollama serve (native)"
  Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep 2
    try { Invoke-WebRequest -Uri "$env:OLLAMA_API_BASE_URL/api/tags" -TimeoutSec 2 -UseBasicParsing | Out-Null; $ollamaUp = $true; break }
    catch {}
  }
} else {
  Write-Host "==> Ollama already running — restart 'ollama serve' if you changed OLLAMA_MAX_LOADED_MODELS/NUM_PARALLEL/KEEP_ALIVE"
}
if (-not $ollamaUp) { Write-Host "ollama failed to start - see .local/logs/ollama.log" -ForegroundColor Red; exit 1 }

# Read model names from .env (fallback defaults) - same parsing as setup.ps1
$llm = "local:disabled"; $vis = "local:yolo11x-plant"
foreach ($line in (Get-Content ".env")) {
  if ($line -match "^LOCAL_LLM_MODEL=(.+)$") { $llm = $Matches[1].Trim().Trim('"').Trim("'") }
  if ($line -match "^VISION_MODEL=(.+)$") { $vis = $Matches[1].Trim().Trim('"').Trim("'") }
}
$ollamaTags = Invoke-RestMethod -Uri "$env:OLLAMA_API_BASE_URL/api/tags" -TimeoutSec 10
$listed = (($ollamaTags.models | ForEach-Object { $_.name }) -join "`n")
foreach ($model in @($llm, $vis)) {
  if ($model -like "local:*" -or $model -eq "") { Write-Host "==> $model is local — skipping Ollama pull"; continue }
  if (-not $listed.Contains($model)) {
    if (-not $ollamaExe) { throw "Ollama model '$model' is missing and ollama.exe was not found on PATH or in $env:LOCALAPPDATA\Programs\Ollama." }
    Write-Host "==> ollama pull $model"
    & $ollamaExe pull $model
    if ($LASTEXITCODE -ne 0) { throw "ollama pull $model failed with exit code $LASTEXITCODE" }
  }
}
Write-Host "==> Ollama OK ($env:OLLAMA_API_BASE_URL)"

# Optional: knowledge-base doc sync (needs metadata.json + network)
if (Test-Path "knowledge_documents/metadata.json") {
  Write-Host "==> Syncing knowledge documents"
  Push-Location "$ROOT/services/groundtruth_ai"
  try { & "$ROOT/.venv/Scripts/python.exe" download_docs.py 2>&1 | Select-Object -Last 3 }
  catch { Write-Host "doc sync skipped (offline?)" }
  Pop-Location
}

function Wait-Port($port) {
  for ($i = 0; $i -lt 30; $i++) {
    $client = New-Object System.Net.Sockets.TcpClient
    $connected = $false
    try {
      $connect = $client.BeginConnect("127.0.0.1", $port, $null, $null)
      $connected = $connect.AsyncWaitHandle.WaitOne(500) -and $client.Connected
    } catch {} finally { $client.Close() }
    if ($connected) { return $true }
    Start-Sleep 2
  }
  return $false
}

$jobs = @()
function Start-Svc($name, $dir, $port) {
  Write-Host "==> $name on :$port"
  $py = "$ROOT/.venv/Scripts/python.exe"
  # NOTE: Start-Job scriptblocks do NOT inherit parent $env, so every value the
  # backend needs is passed explicitly via -ArgumentList and set inside below.
  $job = Start-Job -Name $name -ScriptBlock {
    param($py, $dir, $port, $root, $pyPath, $ollamaUrl, $gtUrl, $ywUrl, $fsUrl, $chroma, $modelDir, $docsDir, $vosk, $reqGpu, $hfHome, $cudaPath, $yoloProv, $ollamaParallel)
    # Secrets live in the root .env - load them here (same file the parent loaded).
    $envFile = Join-Path $root ".env"
    foreach ($line in (Get-Content $envFile)) {
      if ($line -match "^\s*(#|$)") { continue }
      $idx = $line.IndexOf("=")
      if ($idx -gt 0) {
        $k = $line.Substring(0, $idx).Trim()
        $v = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
        if ($k -ne "") { Set-Item -Path ("env:" + $k) -Value $v }
      }
    }
    # Prefer the downloaded Windows-local embedding snapshot when present;
    # the .env default is a model ID that would otherwise require Hub access.
    $embeddingModel = Join-Path $root ".local/models/embedding/paraphrase-MiniLM-L3-v2"
    if (Test-Path (Join-Path $embeddingModel "config.json")) {
      Set-Item -Path "env:EMBEDDING_MODEL_NAME" -Value $embeddingModel
    }
    # Native overrides last - .env carries Docker's service hostnames for compose.
    Set-Item -Path "env:PYTHONPATH" -Value $pyPath
    Set-Item -Path "env:OLLAMA_API_BASE_URL" -Value $ollamaUrl
    Set-Item -Path "env:GROUNDTRUTH_URL" -Value $gtUrl
    Set-Item -Path "env:YIELDWISE_URL" -Value $ywUrl
    Set-Item -Path "env:FIELDSCOUT_URL" -Value $fsUrl
    Set-Item -Path "env:CHROMA_DB_PATH" -Value $chroma
    Set-Item -Path "env:MODEL_DIR" -Value $modelDir
    Set-Item -Path "env:KNOWLEDGE_DOCS_DIR" -Value $docsDir
    Set-Item -Path "env:VOSK_MODEL_PATH" -Value $vosk
    Set-Item -Path "env:REQUIRE_GPU" -Value $reqGpu
    Set-Item -Path "env:HF_HOME" -Value $hfHome
    Set-Item -Path "env:YOLO_PROVIDERS" -Value $yoloProv
    Set-Item -Path "env:OLLAMA_NUM_PARALLEL" -Value $ollamaParallel
    # Service startup logs include Unicode symbols; force UTF-8 under Windows PowerShell.
    Set-Item -Path "env:PYTHONIOENCODING" -Value "utf-8"
    if ($cudaPath -ne "") { $env:PATH = ($cudaPath + ";" + $env:PATH) }
    Set-Location (Join-Path $root ("services/" + $dir))
    & $py -m uvicorn app.main:app --host 127.0.0.1 --port $port
  } -ArgumentList @($py, $dir, $port, $ROOT, $env:PYTHONPATH, $env:OLLAMA_API_BASE_URL, $env:GROUNDTRUTH_URL, $env:YIELDWISE_URL, $env:FIELDSCOUT_URL, $env:CHROMA_DB_PATH, $env:MODEL_DIR, $env:KNOWLEDGE_DOCS_DIR, $env:VOSK_MODEL_PATH, $env:REQUIRE_GPU, $env:HF_HOME, $cudaPath, $env:YOLO_PROVIDERS, $env:OLLAMA_NUM_PARALLEL)
  $script:jobs += $job
}

function Stop-All($webProc) {
  $script:jobs | Stop-Job -ErrorAction SilentlyContinue
  $script:jobs | Remove-Job -ErrorAction SilentlyContinue
  if ($webProc -and -not $webProc.HasExited) {
    & taskkill.exe /PID $webProc.Id /T /F 2>$null | Out-Null
  }
}

function Show-JobOutput($job) {
  if (-not $job) { return }
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = Receive-Job -Job $job -Keep -ErrorAction Continue 2>&1
    foreach ($item in $output) { Write-Host $item.ToString() }
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

Start-Svc "groundtruth" "groundtruth_ai" 8001
Start-Svc "yieldwise" "yieldwise" 8002
Start-Svc "fieldscout" "fieldscout_ai" 8003
Write-Host "==> Waiting for AI services"
$bootFailed = $false
foreach ($svc in @("groundtruth:8001", "yieldwise:8002", "fieldscout:8003")) {
  $parts = $svc.Split(":")
  if (-not (Wait-Port $parts[1])) {
    Write-Host ($parts[0] + " failed to start; service output follows:") -ForegroundColor Red
    $svcJob = Get-Job -Name $parts[0] -ErrorAction SilentlyContinue
    Show-JobOutput $svcJob
    $bootFailed = $true
  }
}
if ($bootFailed) { Stop-All $null; exit 1 }
Start-Svc "platform" "platform_api" 8000
Write-Host "==> Waiting for gateway :8000"
if (-not (Wait-Port 8000)) {
  Write-Host "platform failed to start; service output follows:" -ForegroundColor Red
  $platformJob = Get-Job -Name "platform" -ErrorAction SilentlyContinue
  Show-JobOutput $platformJob
  Stop-All $null; exit 1
}

Write-Host "==> Web on :3000"
$web = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c pnpm run web:dev" -WorkingDirectory $ROOT -PassThru -WindowStyle Normal

Write-Host ""
Write-Host "ALL UP: web http://localhost:3000  api http://localhost:8000" -ForegroundColor Green
Write-Host "Logs: web console window + 'Receive-Job <name>' for backends. Press Ctrl+C to stop everything."
try { while ($true) { Start-Sleep 5 } }
finally {
  Write-Host "==> Stopping services"
  Stop-All $web
}
