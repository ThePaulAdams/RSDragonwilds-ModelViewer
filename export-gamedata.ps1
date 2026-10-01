# Extracts the game's data (items, recipes, spells, quests, loot tables, enemies, chests) to JSON plus WebP item icons.
#   .\export-gamedata.ps1                     -> .\gamedata-out
#   .\export-gamedata.ps1 -Out C:\somewhere
param(
    [string]$GameRoot = "",
    [string]$Out = "",
    [switch]$NoIcons
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
if (-not $Out) { $Out = Join-Path $here "gamedata-out" }
if (-not $GameRoot) {
    foreach ($c in @("F:\Steam\steamapps\common\RSDragonwilds", "C:\Program Files (x86)\Steam\steamapps\common\RSDragonwilds")) {
        if (Test-Path (Join-Path $c "RSDragonwilds\Content\Paks")) { $GameRoot = $c; break }
    }
}
if (-not $GameRoot) { Write-Error "Could not find RSDragonwilds. Pass -GameRoot." }
$paks = Join-Path $GameRoot "RSDragonwilds\Content\Paks"
$usmap = Get-ChildItem -Path (Join-Path $GameRoot "RSDragonwilds\Binaries\Win64") -Filter *.usmap -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $usmap) { Write-Error "No Mappings .usmap found; run .\export-models.ps1 once to create it." }

$dotnet = "dotnet"
if (-not ((& dotnet --list-sdks 2>$null) -match '^10\.')) { $dotnet = Join-Path $here "Exporter\.dotnet\dotnet.exe" }
$proj = Join-Path $here "Exporter\ModelExporter.csproj"
& $dotnet build $proj -c Release --nologo -v quiet
if ($LASTEXITCODE -ne 0) { Write-Error "Exporter build failed." }
$args2 = @("gamedata", $paks, $usmap.FullName, $Out)
if ($NoIcons) { $args2 += "--no-icons" }
& $dotnet (Join-Path $here "Exporter\bin\Release\net10.0\ModelExporter.dll") @args2
