param(
    [string]$PbfFileName = "malaysia-singapore-brunei-260712.osm.pbf"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PbfPath = Join-Path $RepoRoot "osm-data\$PbfFileName"
$PrepareScript = Join-Path $RepoRoot "backend\modules\live-dispatch\routing\prepare-osrm.ps1"
$ComposeFile = Join-Path $RepoRoot "backend\modules\live-dispatch\routing\docker-compose.yml"
$GraphMetrics = Join-Path $RepoRoot "backend\modules\live-dispatch\routing\routing-data\greater-kl.osrm.cell_metrics"

Write-Host ""
Write-Host "ANWAR local routing setup" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $PbfPath -PathType Leaf)) {
    Write-Host ""
    Write-Host "Missing OpenStreetMap PBF:" -ForegroundColor Red
    Write-Host "  $PbfPath"
    Write-Host ""
    Write-Host "Download the shared PBF and place it in osm-data with the exact filename above."
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker Desktop is required but the docker command was not found." -ForegroundColor Red
    exit 1
}

docker info --format "{{.ServerVersion}}" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker Desktop is installed but its engine is not running." -ForegroundColor Red
    Write-Host "Start Docker Desktop, wait until it is ready, then run this script again."
    exit 1
}

if (-not (Test-Path -LiteralPath $GraphMetrics -PathType Leaf)) {
    Write-Host "Building the Greater KL road graph. This one-time step can take several minutes..."
    & powershell -ExecutionPolicy Bypass -File $PrepareScript -PbfPath $PbfPath
    if ($LASTEXITCODE -ne 0) {
        throw "OSRM graph preparation failed with exit code $LASTEXITCODE"
    }
} else {
    Write-Host "Existing Greater KL road graph found; skipping rebuild." -ForegroundColor DarkGray
}

Write-Host "Starting local OSRM..."
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) {
    throw "OSRM startup failed with exit code $LASTEXITCODE"
}

$HealthUrl = "http://127.0.0.1:5000/route/v1/driving/101.6906,3.1667;101.7073,3.1439?overview=false"
$Route = $null
for ($Attempt = 1; $Attempt -le 30; $Attempt += 1) {
    try {
        $Route = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
        if ($Route.code -eq "Ok") { break }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if ($null -eq $Route -or $Route.code -ne "Ok") {
    Write-Host "OSRM started but did not become ready within 30 seconds." -ForegroundColor Red
    Write-Host "Inspect it with: docker compose -f backend/modules/live-dispatch/routing/docker-compose.yml logs"
    exit 1
}

$DistanceKm = [math]::Round($Route.routes[0].distance / 1000, 2)
$Minutes = [math]::Round($Route.routes[0].duration / 60, 1)
Write-Host ""
Write-Host "Local routing is ready." -ForegroundColor Green
Write-Host "OSRM:     http://127.0.0.1:5000"
Write-Host "Test:     $DistanceKm km / $Minutes min"
Write-Host "Backend:  python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000"
Write-Host "Frontend: cd frontend; npm run dev"
