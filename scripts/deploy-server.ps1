param(
  [string]$AppDirectory = "C:\Users\stimanios\Documents\ERPMES",
  [int]$Port = 3000,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

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

if (-not (Test-Path -LiteralPath "node_modules")) {
  npm ci
} else {
  npm install --no-audit --no-fund
}

npx prisma generate
npx prisma migrate deploy
npm run build

if (-not (Test-Path -LiteralPath "logs")) {
  New-Item -ItemType Directory -Path "logs" | Out-Null
}

$env:ERPMES_PORT = $Port
pm2 startOrReload "deploy/ecosystem.config.js" --env production
pm2 save

Write-Host "Deploiement prepare. Verifiez http://localhost:$Port/api/health"
