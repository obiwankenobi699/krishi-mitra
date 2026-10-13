# Full project restart (Windows twin): free ports, relaunch dev stack.
# Run:  powershell -ExecutionPolicy Bypass -File scripts/restart.ps1
$ErrorActionPreference = "Continue"
$ROOT = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $ROOT
$env:PATH = "$env:USERPROFILE\.local\share\mise\shims;" + $env:PATH

Write-Host "==> Stopping project processes (ports 3000, 8000-8003)"
foreach ($p in @(3000, 8000, 8001, 8002, 8003)) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      Write-Host "    killing :$p pid $($c.OwningProcess)"
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}
Start-Sleep 3
$stuck = @(3000, 8000, 8001, 8002, 8003) | Where-Object {
  Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
}
if ($stuck.Count -gt 0) {
  Write-Host "Ports still held: $($stuck -join ', ') — kill owners in Task Manager and re-run." -ForegroundColor Red
  exit 1
}
Write-Host "    ports free"

Write-Host "==> Starting stack (scripts/dev.ps1)"
& "$ROOT/scripts/dev.ps1"
