# Installation de GroupTerm sur ce PC.
# - Installe les dépendances (npm install)
# - Crée un raccourci "GroupTerm" sur le Bureau
# - Ajoute l'entrée clic droit "Ouvrir GroupTerm ici" (dossier + fond de dossier)
#
# Lancer :  clic droit sur ce fichier > "Exécuter avec PowerShell"
#   ou :    powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
Write-Host "=== Installation de GroupTerm ===" -ForegroundColor Cyan
Write-Host "Dossier : $dir"

# --- 1. Vérifie Node.js ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js n'est pas installe. Installe-le d'abord : https://nodejs.org (LTS)" -ForegroundColor Red
  Read-Host "Appuie sur Entree pour quitter"
  exit 1
}
Write-Host "Node.js : $(node --version)" -ForegroundColor DarkGray

# --- 2. Dépendances ---
Write-Host "Installation des dependances (npm install)..." -ForegroundColor DarkGray
Push-Location $dir
npm install
Pop-Location

# --- 3. Raccourci Bureau ---
$launch = Join-Path $dir 'gt-launch.ps1'
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$desktop = [Environment]::GetFolderPath('Desktop')
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut((Join-Path $desktop 'GroupTerm.lnk'))
$lnk.TargetPath = $ps
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launch`""
$lnk.WorkingDirectory = $dir
$lnk.IconLocation = "$ps,0"
$lnk.Description = 'Terminal partage GroupTerm'
$lnk.Save()
Write-Host "Raccourci cree : $desktop\GroupTerm.lnk" -ForegroundColor Green

# Raccourci "Reglages" (re-demande nom / room / serveur)
$lnk2 = $wsh.CreateShortcut((Join-Path $desktop 'GroupTerm - Reglages.lnk'))
$lnk2.TargetPath = $ps
$lnk2.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launch`" -setup"
$lnk2.WorkingDirectory = $dir
$lnk2.IconLocation = "$ps,0"
$lnk2.Description = 'Changer nom / room / serveur GroupTerm'
$lnk2.Save()
Write-Host "Raccourci cree : $desktop\GroupTerm - Reglages.lnk" -ForegroundColor Green

# Raccourci "Arreter" (ferme tes terminaux + le hub ; garde le relais)
$lnk3 = $wsh.CreateShortcut((Join-Path $desktop 'GroupTerm - Arreter.lnk'))
$lnk3.TargetPath = $ps
$lnk3.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launch`" -stop"
$lnk3.WorkingDirectory = $dir
$lnk3.IconLocation = "$ps,0"
$lnk3.Description = 'Fermer tes terminaux GroupTerm + le hub (le relais reste)'
$lnk3.Save()
Write-Host "Raccourci cree : $desktop\GroupTerm - Arreter.lnk" -ForegroundColor Green

# --- 4. Clic droit (HKCU, sans admin) ---
$cmdDir = "$ps -NoProfile -ExecutionPolicy Bypass -File `"$launch`" `"%1`""
$cmdBg  = "$ps -NoProfile -ExecutionPolicy Bypass -File `"$launch`" `"%V`""
$icon   = "$ps,0"

New-Item -Path 'HKCU:\Software\Classes\Directory\shell\GroupTerm\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\Directory\shell\GroupTerm' -Name '(default)' -Value 'Ouvrir GroupTerm ici'
Set-ItemProperty -Path 'HKCU:\Software\Classes\Directory\shell\GroupTerm' -Name 'Icon' -Value $icon
Set-ItemProperty -Path 'HKCU:\Software\Classes\Directory\shell\GroupTerm\command' -Name '(default)' -Value $cmdDir

New-Item -Path 'HKCU:\Software\Classes\Directory\Background\shell\GroupTerm\command' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Classes\Directory\Background\shell\GroupTerm' -Name '(default)' -Value 'Ouvrir GroupTerm ici'
Set-ItemProperty -Path 'HKCU:\Software\Classes\Directory\Background\shell\GroupTerm' -Name 'Icon' -Value $icon
Set-ItemProperty -Path 'HKCU:\Software\Classes\Directory\Background\shell\GroupTerm\command' -Name '(default)' -Value $cmdBg
Write-Host "Clic droit 'Ouvrir GroupTerm ici' ajoute." -ForegroundColor Green

Write-Host ""
Write-Host "=== Termine ! ===" -ForegroundColor Cyan
Write-Host "Double-clique sur GroupTerm (Bureau). La 1ere fois, il demande :"
Write-Host "  - ton nom (ex: bob)"
Write-Host "  - la room (IDENTIQUE a ton binome, ex: notre-projet)"
Write-Host "  - le serveur : mets l'adresse Tailscale du PC qui heberge (ex: 100.x.x.x)"
Write-Host "    (laisse vide seulement si C'EST TOI qui heberges le serveur)"
Read-Host "Appuie sur Entree pour fermer"
