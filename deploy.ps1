# Publishes the model data to the hosted site (Railway).
#   .\deploy.ps1
# Builds a slim copy of export\ in web-data\ (textures as 512px WebP, meshes meshopt-compressed),
# then uploads only the files the site doesn't have yet. The site's code deploys from GitHub on push.
# Needs: `railway login` done once, and this folder linked to the service (`railway link`).
param(
    [int]$TextureSize = 512,
    [string]$Url = ""          # site address; read from Railway if empty
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$web = Join-Path $here "web-data"
$dotnet = Join-Path $here "Exporter\.dotnet\dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = "dotnet" }
$exporter = Join-Path $here "Exporter\bin\Release\net10.0\ModelExporter.dll"

if (-not (Test-Path (Join-Path $here "export\models.json"))) { Write-Error "No export yet. Run .\export-models.ps1 first." }

# ---- 1. Slim web copy ----
Write-Host "Building the web copy..." -ForegroundColor Yellow
& $dotnet build (Join-Path $here "Exporter\ModelExporter.csproj") -c Release --nologo -v quiet
if ($LASTEXITCODE -ne 0) { Write-Error "Exporter build failed." }
& $dotnet $exporter web (Join-Path $here "export") $web --max $TextureSize
if ($LASTEXITCODE -ne 0) { Write-Error "Web copy failed." }

$tools = Join-Path $here "tools"
if (-not (Test-Path (Join-Path $tools "node_modules"))) {
    Push-Location $tools; try { npm install --silent --no-audit --no-fund } finally { Pop-Location }
}
Write-Host "Compressing new models..." -ForegroundColor Yellow
node (Join-Path $tools "compress-glb.mjs") $web
if ($LASTEXITCODE -ne 0) { Write-Error "Compressing models failed." }
# Build-piece list for the base builder (written by export-models.ps1).
$pieces = Join-Path $here "export\pieces.json"
if (Test-Path $pieces) { Copy-Item $pieces (Join-Path $web "pieces.json") -Force }
# World map for the base builder (written by export-models.ps1).
$world = Join-Path $here "export\world"
if (Test-Path $world) { Copy-Item $world $web -Recurse -Force }

# ---- 2. Upload token (a random secret shared with the site; kept in .deploy-token, never committed) ----
$tokenFile = Join-Path $here ".deploy-token"
if (-not (Test-Path $tokenFile)) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') | Set-Content $tokenFile -NoNewline
    Write-Host "Setting the upload token on the Railway service..." -ForegroundColor Yellow
    railway variables --set "UPLOAD_TOKEN=$(Get-Content $tokenFile -Raw)" | Out-Null
    if ($LASTEXITCODE -ne 0) { Remove-Item $tokenFile; Write-Error "Could not set UPLOAD_TOKEN. Is this folder linked (railway link)?" }
}

# ---- 3. Upload what changed ----
if (-not $Url) {
    $domain = (railway domain --json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue)
    $Url = @($domain.domains, $domain.domain, $domain) | Where-Object { $_ -is [string] -and $_ -match '\.' } | Select-Object -First 1
    if (-not $Url) { Write-Error "Could not find the site address. Pass -Url https://<your-site>." }
    if ($Url -notmatch '^https?://') { $Url = "https://$Url" }
}
# The site restarts when UPLOAD_TOKEN changes; wait until it accepts the token.
$auth = @{ Authorization = "Bearer $((Get-Content $tokenFile -Raw).Trim())" }
$deadline = (Get-Date).AddMinutes(8)
while ($true) {
    try { Invoke-WebRequest "$Url/_data/list" -Headers $auth -UseBasicParsing -TimeoutSec 20 | Out-Null; break }
    catch {
        if ((Get-Date) -gt $deadline) { Write-Error "The site at $Url did not accept the upload token. Check the Railway deploy logs." }
        Write-Host "Waiting for the site to be ready..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 15
    }
}
Write-Host "Uploading to $Url ..." -ForegroundColor Yellow
& $dotnet $exporter sync $web $Url $tokenFile
if ($LASTEXITCODE -ne 0) { Write-Error "Upload failed." }
Write-Host "Done: $Url" -ForegroundColor Green
