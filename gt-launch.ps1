# Lanceur GroupTerm — ouvre un terminal partagé en un double-clic.
# - Retient ton nom / room / serveur dans %USERPROFILE%\.groupterm.json
# - Démarre le serveur tout seul si tu te connectes à "ce PC" (localhost)
# - Lance ton shell partagé (gt.js) dans le dossier voulu
#
# Usage : gt-launch.ps1 [dossier]   (le dossier vient du clic droit)
#         gt-launch.ps1 -setup       (re-demande nom/room/serveur)

param([string]$Folder, [switch]$setup)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot                      # dossier du projet (où sont gt.js / server.js)
$cfgPath = Join-Path $env:USERPROFILE '.groupterm.json'

function Ask($label, $current, $default) {
  $shown = if ($current) { $current } else { $default }
  $v = Read-Host "$label [$shown]"
  if ([string]::IsNullOrWhiteSpace($v)) { return $shown } else { return $v.Trim() }
}

# --- Charge la config existante ---
$cfg = $null
if (Test-Path $cfgPath) { try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json } catch {} }
$name   = if ($cfg) { $cfg.name }   else { $null }
$room   = if ($cfg) { $cfg.room }   else { $null }
$server = if ($cfg) { $cfg.server } else { $null }

# --- Première utilisation (ou -setup) : on demande les infos ---
if (-not $name -or -not $room -or -not $server -or $setup) {
  Write-Host ""
  Write-Host "=== Configuration GroupTerm ===" -ForegroundColor Cyan
  Write-Host "(laisse vide pour garder la valeur entre crochets)" -ForegroundColor DarkGray
  $name   = Ask "Ton nom (ex: alice)" $name "moi"
  $room   = Ask "Nom de la room (IDENTIQUE chez ton pote)" $room "notre-projet"
  Write-Host "Serveur : laisse vide si LE SERVEUR tourne sur CE PC." -ForegroundColor DarkGray
  Write-Host "          Sinon mets l'adresse du PC qui heberge (ex: 100.x.x.x ou 192.168.1.20)." -ForegroundColor DarkGray
  $server = Ask "Serveur" $server "ws://localhost:4242"
  # Normalise : ajoute ws:// et :4242 si absent
  if ($server -notmatch '^ws://') { $server = "ws://$server" }
  if ($server -notmatch '^ws://[^/]+:\d+') { $server = "$server`:4242" }
  @{ name = $name; room = $room; server = $server } | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding UTF8
  Write-Host "Config enregistree dans $cfgPath" -ForegroundColor DarkGray
}

Write-Host "GroupTerm : $name @ #$room  ->  $server" -ForegroundColor DarkGray
Write-Host "(relance avec -setup pour changer)" -ForegroundColor DarkGray

# --- Si le serveur est local, on le démarre s'il ne tourne pas déjà ---
$port = 4242
if ($server -match ':(\d+)') { $port = [int]$matches[1] }
$isLocal = $server -match '(localhost|127\.0\.0\.1)'
if ($isLocal) {
  $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    Write-Host "Demarrage du serveur local sur le port $port..." -ForegroundColor DarkGray
    Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile","-Command","cd '$dir'; `$env:PORT=$port; node server.js"
    Start-Sleep -Seconds 2
  }
}

# --- Dossier de départ du shell ---
if (-not $Folder -or -not (Test-Path $Folder)) { $Folder = $env:USERPROFILE }

# --- Lance le shell partagé (prend la main sur cette fenêtre) ---
$env:GT_SERVER = $server
$env:GT_NAME   = $name
$env:GT_ROOM   = $room
Set-Location $Folder
& node (Join-Path $dir 'gt.js') $name $room
