# Retire le raccourci Bureau et les entrées clic droit de GroupTerm.
# (Ne supprime pas le dossier du projet ni node_modules.)
$desktop = [Environment]::GetFolderPath('Desktop')
Remove-Item (Join-Path $desktop 'GroupTerm.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Classes\Directory\shell\GroupTerm' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Classes\Directory\Background\shell\GroupTerm' -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "GroupTerm desinstalle (raccourci + clic droit retires)."
