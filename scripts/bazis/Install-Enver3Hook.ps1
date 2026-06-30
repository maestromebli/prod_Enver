# ENVER — встановлення auto-ENVER3 хука для GibLab Export у Базіс-Мебельщик
# Запуск від імені користувача Базіс (PowerShell):
#   .\Install-Enver3Hook.ps1 -BazisScriptsDir "C:\Program Files\Bazis\Scripts"

param(
  [string]$BazisScriptsDir = "",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

$hookSnippet = @'
try {
  ENVER_AUTO_B3D_PATH = savedB3dPath;
  Execute(system.getFileName("enver-b3d-assembly-export.js"));
} catch (e) {}
'@

function Find-GibLabExport($dir) {
  Get-ChildItem -Path $dir -Filter "GibLabExport*.js" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if (-not $RepoRoot) {
  $RepoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
}
$sourceScript = Join-Path $RepoRoot "scripts\enver-b3d-assembly-export.js"
if (-not (Test-Path $sourceScript)) {
  throw "Не знайдено $sourceScript — запустіть з клону ENVER."
}

if (-not $BazisScriptsDir) {
  $candidates = @(
    "$env:USERPROFILE\Documents\Bazis\Scripts",
    "$env:USERPROFILE\Bazis\Scripts",
    "C:\Program Files\Bazis\Scripts",
    "C:\Program Files (x86)\Bazis\Scripts"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $BazisScriptsDir = $c; break }
  }
}

if (-not $BazisScriptsDir -or -not (Test-Path $BazisScriptsDir)) {
  throw "Вкажіть -BazisScriptsDir (папка скриптів Базіс)."
}

$destScript = Join-Path $BazisScriptsDir "enver-b3d-assembly-export.js"
Copy-Item -Path $sourceScript -Destination $destScript -Force
Write-Host "✓ Скопійовано enver-b3d-assembly-export.js → $destScript"

$giblab = Find-GibLabExport $BazisScriptsDir
if (-not $giblab) {
  Write-Warning "GibLabExport*.js не знайдено в $BazisScriptsDir — додайте хук вручну:"
  Write-Host $hookSnippet
  exit 0
}

$content = Get-Content -Path $giblab.FullName -Raw -Encoding UTF8
if ($content -match "enver-b3d-assembly-export") {
  Write-Host "✓ Хук ENVER3 вже є в $($giblab.Name)"
  exit 0
}

$marker = "// ENVER auto ENVER3 hook"
$newContent = $content.TrimEnd() + "`r`n`r`n$marker`r`n$hookSnippet`r`n"
Set-Content -Path $giblab.FullName -Value $newContent -Encoding UTF8
Write-Host "✓ Хук додано в $($giblab.FullName)"
Write-Host "  Перезапустіть Базіс і зробіть тестовий експорт .b3d."
