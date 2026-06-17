# ENVER Folder Agent — встановлення служби Windows
# Запуск від адміністратора:
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1

$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  Write-Error "Node.js не знайдено. Встановіть Node 22+."
  exit 1
}

if (-not (Test-Path "$AgentDir\config.json")) {
  Copy-Item "$AgentDir\config.example.json" "$AgentDir\config.json"
  Write-Host "Створено config.json — відредагуйте enverUrl, enverToken, rootPath"
}

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
  & nssm install EnverFolderAgent $Node "$AgentDir\src\index.js"
  & nssm set EnverFolderAgent AppDirectory $AgentDir
  & nssm start EnverFolderAgent
  Write-Host "Службу EnverFolderAgent встановлено через NSSM"
} else {
  Write-Host @"
NSSM не знайдено. Запуск вручну:
  cd $AgentDir
  node src/index.js

Або встановіть NSSM: https://nssm.cc/download
"@
}
