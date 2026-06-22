# Lanceur GroupTerm — ouvre un terminal partagé en un double-clic.
# - Retient PLUSIEURS connexions (profils) dans %USERPROFILE%\.groupterm.json
#   et propose un menu si tu en as plusieurs (Entrée = rouvrir la dernière).
# - Démarre le serveur tout seul si tu te connectes à "ce PC" (localhost / IP locale).
# - Affiche un bloc d'état clair (qui tu es, serveur, qui est déjà là).
# - Ouvre le hub web (centre de contrôle) dans ton navigateur par défaut.
#
# Usage : gt-launch.ps1 [dossier]   (le dossier vient du clic droit)
#         gt-launch.ps1 -setup       (ajoute une nouvelle connexion)
#         gt-launch.ps1 -nodash      (ne pas ouvrir le hub web)
#         gt-launch.ps1 -stop        (ferme TES terminaux + le hub ; garde le relais)
#         gt-launch.ps1 -stopall     (arrete aussi le relais -> deconnecte le binome)

param([string]$Folder, [switch]$setup, [switch]$nodash, [switch]$stop, [switch]$stopall)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot                      # dossier du projet (gt.js / server.js / gt-hub.js)
$cfgPath = Join-Path $env:USERPROFILE '.groupterm.json'

# Tue les process node de CE projet (identifies par le dossier dans leur ligne de commande).
function Stop-GtProcs([string[]]$scripts) {
  $pat = [regex]::Escape($dir)
  $n = 0
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $cl = $_.CommandLine
      $cl -and ($cl -match $pat) -and (@($scripts | Where-Object { $cl -match ([regex]::Escape($_)) }).Count -gt 0)
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
  return $n
}

# --- Arret propre (avant toute autre logique) ---
if ($stop -or $stopall) {
  $scripts = @('gt.js', 'gt-hub.js', 'gt-dash.js')
  if ($stopall) {
    Write-Host "Arret COMPLET : le relais sera coupe -> ton binome sera deconnecte." -ForegroundColor Yellow
    $ans = Read-Host "Confirmer ? (o/N)"
    if ($ans -notmatch '^(o|oui|y|yes)$') { Write-Host "Annule." -ForegroundColor DarkGray; exit 0 }
    $scripts += 'server.js'
  }
  $killed = Stop-GtProcs $scripts
  if ($stopall) {
    # Filet : le relais a pu etre lance sans chemin complet -> cible aussi le
    # process node qui ecoute sur le port GroupTerm (4242 par defaut).
    $owner = Get-NetTCPConnection -LocalPort 4242 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
    if ($owner) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
      if ($p -and $p.Name -eq 'node.exe') { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue; $killed++ }
    }
  }
  Write-Host "$killed process GroupTerm arrete(s)." -ForegroundColor DarkGray
  if (-not $stopall) { Write-Host "(le relais tourne toujours ; -stopall pour l'arreter aussi)" -ForegroundColor DarkGray }
  Start-Sleep -Seconds 1
  exit 0
}

function Ask($label, $current, $default) {
  $shown = if ($current) { $current } else { $default }
  $v = Read-Host "$label [$shown]"
  if ([string]::IsNullOrWhiteSpace($v)) { return $shown } else { return $v.Trim() }
}

# --- Charge la config et la normalise en liste de profils (rétro-compatible) ---
$cfg = $null
if (Test-Path $cfgPath) { try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json } catch {} }
$conns = @()
$last = 0
if ($cfg) {
  if ($cfg.PSObject.Properties.Name -contains 'profiles') {
    $conns = @($cfg.profiles)
    if ($cfg.PSObject.Properties.Name -contains 'last') { $last = [int]$cfg.last }
  } elseif ($cfg.name) {
    # Ancien format { name, room, server } -> un seul profil
    $conns = @([pscustomobject]@{ name = $cfg.name; room = $cfg.room; server = $cfg.server })
    $last = 0
  }
}
if ($last -lt 0 -or $last -ge $conns.Count) { $last = 0 }

function Save-Profiles {
  @{ profiles = $conns; last = $last } | ConvertTo-Json -Depth 5 | Set-Content -Path $cfgPath -Encoding UTF8
}

function New-Profile {
  Write-Host ""
  Write-Host "=== Nouvelle connexion GroupTerm ===" -ForegroundColor Cyan
  Write-Host "(laisse vide pour garder la valeur entre crochets)" -ForegroundColor DarkGray
  $n = Ask "Ton nom (ex: alice)" $null "moi"
  $r = Ask "Nom de la room (IDENTIQUE chez ton pote)" $null "notre-projet"
  Write-Host "Serveur : laisse vide si LE SERVEUR tourne sur CE PC." -ForegroundColor DarkGray
  Write-Host "          Sinon mets l'adresse du PC qui heberge (ex: 100.x.x.x ou 192.168.1.20)." -ForegroundColor DarkGray
  $s = Ask "Serveur" $null "ws://localhost:4242"
  if ($s -notmatch '^ws://') { $s = "ws://$s" }
  if ($s -notmatch '^ws://[^/]+:\d+') { $s = "$s`:4242" }
  return [pscustomobject]@{ name = $n; room = $r; server = $s }
}

# --- Choix du profil ---
$conn = $null
if ($setup -or $conns.Count -eq 0) {
  $conn = New-Profile
  $conns = @($conns + $conn)
  $last = $conns.Count - 1
  Save-Profiles
} elseif ($conns.Count -eq 1) {
  $conn = $conns[0]; $last = 0
} else {
  Write-Host ""
  Write-Host "GroupTerm - choisis une connexion :" -ForegroundColor Cyan
  for ($i = 0; $i -lt $conns.Count; $i++) {
    $p = $conns[$i]
    $tag = if ($i -eq $last) { "   [dernier]" } else { "" }
    Write-Host ("  {0}) {1} @ #{2}  ({3}){4}" -f ($i + 1), $p.name, $p.room, $p.server, $tag)
  }
  Write-Host "  [n] nouvelle    [Entree] = dernier" -ForegroundColor DarkGray
  $choice = Read-Host "Choix"
  if ([string]::IsNullOrWhiteSpace($choice)) {
    $conn = $conns[$last]
  } elseif ($choice -eq 'n') {
    $conn = New-Profile
    $conns = @($conns + $conn)
    $last = $conns.Count - 1
    Save-Profiles
  } else {
    $idx = ([int]$choice) - 1
    if ($idx -ge 0 -and $idx -lt $conns.Count) { $conn = $conns[$idx]; $last = $idx; Save-Profiles }
    else { $conn = $conns[$last] }
  }
}

$name = $conn.name; $room = $conn.room; $server = $conn.server

# --- Si le serveur tourne sur CE PC (localhost OU une de nos IP, ex. Tailscale),
#     on le démarre s'il ne tourne pas déjà ---
$port = 4242
if ($server -match ':(\d+)') { $port = [int]$matches[1] }
$srvHost = if ($server -match '^ws://([^:/]+)') { $matches[1] } else { $null }
$localIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress)
$isLocal = ($srvHost -match '^(localhost|127\.0\.0\.1)$') -or ($localIps -contains $srvHost)
if ($isLocal) {
  $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    Write-Host "Demarrage du serveur local sur le port $port..." -ForegroundColor DarkGray
    # Chemin complet : permet de retrouver/arreter ce relais proprement (cf. -stopall).
    Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile","-Command","cd '$dir'; `$env:PORT=$port; node '$dir\server.js'"
    Start-Sleep -Seconds 2
  }
}

# --- Bloc d'état : qui tu es, serveur, qui est déjà là (via la commande `who`) ---
$env:GT_SERVER = $server
$env:GT_NAME   = $name
$env:GT_ROOM   = $room
Write-Host ""
Write-Host "GroupTerm - tu es $name @ #$room" -ForegroundColor Cyan
$whoRaw = & node (Join-Path $dir 'gt-tool.js') who 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
  Write-Host "Serveur : $server   [connecte]" -ForegroundColor DarkGray
  $members = ($whoRaw -split "`n") | Where-Object { $_ -match '—' } | ForEach-Object { $_.Trim() }
  if ($members) { Write-Host ("Deja la : " + ($members -join '   |   ')) -ForegroundColor DarkGray }
  else { Write-Host "Deja la : personne (tu seras le premier)" -ForegroundColor DarkGray }
} else {
  Write-Host "Serveur : $server   [injoignable pour l'instant]" -ForegroundColor DarkYellow
}
Write-Host "(relance avec -setup pour ajouter une connexion)" -ForegroundColor DarkGray

# --- Dossier de départ du shell ---
if (-not $Folder -or -not (Test-Path $Folder)) { $Folder = $env:USERPROFILE }

# --- Démarre le hub web (centre de contrôle) — un seul par PC ---
# Le hub sert la page sur localhost:4243 et ouvre ton navigateur. On relance
# TOUJOURS un hub frais : un hub déjà en cours peut pointer un ancien serveur ou
# tourner sur une version précédente du code (d'où des rooms fantômes / vides).
if (-not $nodash) {
  $hubPort = 4243
  $hubPath = Join-Path $dir 'gt-hub.js'
  $env:GT_CWD = $Folder    # dossier ou s'ouvriront les terminaux lances depuis le hub

  # Tue un éventuel hub déjà en cours (pour repartir sur le code + serveur courants).
  $hubWasUp = $false
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'gt-hub\.js' } |
    ForEach-Object { $hubWasUp = $true; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($hubWasUp) { Start-Sleep -Milliseconds 300 }

  if ($hubWasUp) {
    # Un onglet est probablement déjà ouvert : il se reconnectera tout seul.
    $env:GT_NO_BROWSER = '1'
    Write-Host "Hub web relance (l'onglet existant se reconnecte) : http://localhost:$hubPort" -ForegroundColor DarkGray
  } else {
    Remove-Item Env:GT_NO_BROWSER -ErrorAction SilentlyContinue
    Write-Host "Ouverture du hub web (http://localhost:$hubPort)..." -ForegroundColor DarkGray
  }
  # Le hub herite de GT_SERVER / GT_NAME deja definis ci-dessus.
  Start-Process node -WindowStyle Hidden -WorkingDirectory $dir -ArgumentList @("`"$hubPath`"", $name)
}

# --- Lance le shell partagé (prend la main sur cette fenêtre) ---
Set-Location $Folder
& node (Join-Path $dir 'gt.js') $name $room
