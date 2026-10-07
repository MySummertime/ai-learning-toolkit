[CmdletBinding()]
param(
  [int]$Port = 0,
  [int]$ServicePort = 0,
  [switch]$Preview
)
$ErrorActionPreference = 'Stop'
$serverConfig = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'server.json') -Raw | ConvertFrom-Json
if ($Port -eq 0) { $Port = [int]$serverConfig.pagePort }
if ($ServicePort -eq 0) { $ServicePort = [int]$serverConfig.servicePort }
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pythonPath = Join-Path $repoRoot 'runtime/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
  throw '缺少 runtime/.venv/Scripts/python.exe'
}
$argsList = @('-B', (Join-Path $PSScriptRoot 'scripts/start.py'), '--port', "$Port", '--service-port', "$ServicePort")
if ($Preview) { $argsList += '--preview' }
& $pythonPath @argsList
if ($LASTEXITCODE -ne 0) { throw "recitation-studio启动失败，退出码 $LASTEXITCODE" }
