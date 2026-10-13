# Telegram long-polling worker (Windows twin of scripts/tg-poll.py).
# No tunnel, no public URL. Forwards updates to the local gateway webhook.
# Run:  powershell -ExecutionPolicy Bypass -File scripts/tg-poll.ps1
$ErrorActionPreference = "Continue"
$ROOT = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $ROOT

function Get-DotEnv($name) {
  foreach ($line in (Get-Content "$ROOT/.env" -ErrorAction SilentlyContinue)) {
    if ($line -match "^\s*$name=(.+)$") { return $Matches[1].Trim().Trim('"').Trim("'") }
  }
  return ""
}

$botToken = Get-DotEnv "TELEGRAM_BOT_TOKEN"
$secret = Get-DotEnv "TELEGRAM_WEBHOOK_SECRET"
$baseUrl = "http://localhost:8000"
if (-not $botToken) { Write-Host "TELEGRAM_BOT_TOKEN missing in .env" -ForegroundColor Red; exit 1 }

try {
  $me = Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/getMe" -TimeoutSec 15
  Write-Host "polling as @$($me.result.username)"
} catch { Write-Host "getMe failed: $_" -ForegroundColor Red; exit 1 }

try {
  Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/deleteWebhook" -Method Post `
    -Body (@{drop_pending_updates = $false} | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 15 | Out-Null
  Write-Host "webhook mode off (polling owns delivery now)"
} catch { Write-Host "deleteWebhook note: $_" }

$offsetFile = "$ROOT/.local/tg-offset"
$offset = 0
if (Test-Path $offsetFile) {
  try { $offset = [int](Get-Content $offsetFile -Raw).Trim() } catch { $offset = 0 }
}

$backoff = 1
while ($true) {
  try {
    $batch = Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/getUpdates" -Method Post `
      -Body (@{offset = $offset; timeout = 50; allowed_updates = @("message")} | ConvertTo-Json -Depth 5) `
      -ContentType "application/json" -TimeoutSec 70
    $backoff = 1
  } catch {
    Write-Host "getUpdates failed; retry in ${backoff}s"
    Start-Sleep $backoff
    $backoff = [Math]::Min($backoff * 2, 60)
    continue
  }
  foreach ($update in $batch.result) {
    try {
      Invoke-RestMethod -Uri "$baseUrl/telegram/webhook" -Method Post `
        -Body ($update | ConvertTo-Json -Depth 10 -Compress) -ContentType "application/json" `
        -Headers @{"X-Telegram-Bot-Api-Secret-Token" = $secret} -TimeoutSec 30 | Out-Null
    } catch {
      Write-Host "forward failed for update $($update.update_id); will retry"
      Start-Sleep 2
      break
    }
    $offset = [int]$update.update_id + 1
    try { Set-Content $offsetFile $offset -NoNewline } catch {}
  }
}
