param(
  [string]$AppDirectory = (Split-Path -Parent $PSScriptRoot),
  [ValidateRange(1, 65535)]
  [int]$Port = 3000,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

# Windows PowerShell ne leve pas d'exception sur un code de sortie natif non nul.
function Invoke-CheckedCommand {
  param(
    [string]$Command,
    [string[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Echec de $Command (code $LASTEXITCODE). Deploiement interrompu."
  }
}

if (-not (Test-Path -LiteralPath $AppDirectory)) {
  throw "Dossier applicatif introuvable : $AppDirectory"
}

Set-Location -LiteralPath $AppDirectory

if (-not $Apply) {
  Write-Host "Mode simulation : aucune commande destructive ne sera executee."
  Write-Host "Pour appliquer le deploiement, relancez avec -Apply."
  Write-Host "Port cible : $Port"
  exit 0
}

$nodeMajor = [int]((node --version) -replace "^v(\d+).*", '$1')
if ($nodeMajor -lt 20) {
  throw "Node.js 20 ou superieur est requis."
}

# Le lockfile est la reference, y compris lors des deploiements suivants.
Invoke-CheckedCommand -Command "npm" -Arguments @("ci", "--no-audit", "--no-fund")
Invoke-CheckedCommand -Command "npx" -Arguments @("prisma", "generate")
Invoke-CheckedCommand -Command "npx" -Arguments @("prisma", "migrate", "deploy")
Invoke-CheckedCommand -Command "npm" -Arguments @("run", "build")

if (-not (Test-Path -LiteralPath "logs")) {
  New-Item -ItemType Directory -Path "logs" | Out-Null
}

$env:ERPMES_PORT = $Port
Invoke-CheckedCommand -Command "pm2" -Arguments @("startOrReload", "deploy/ecosystem.config.js", "--env", "production")
Invoke-CheckedCommand -Command "pm2" -Arguments @("save")

Write-Host "Deploiement prepare. Verifiez http://localhost:$Port/api/health"
