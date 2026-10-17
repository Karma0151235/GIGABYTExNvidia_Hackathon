param(
    [string]$PbfPath = "../../../../osm-data/malaysia-singapore-brunei-260712.osm.pbf",
    [string]$BoundingBox = "101.45,2.90,101.90,3.35"
)

$ErrorActionPreference = "Stop"
$RoutingDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $RoutingDir "routing-data"
$PbfCandidate = if ([System.IO.Path]::IsPathRooted($PbfPath)) {
    $PbfPath
} else {
    Join-Path $RoutingDir $PbfPath
}
$ResolvedPbf = (Resolve-Path $PbfCandidate).Path
$SourceDir = Split-Path -Parent $ResolvedPbf
$SourceName = Split-Path -Leaf $ResolvedPbf
$LocalPbf = Join-Path $DataDir "greater-kl.osm.pbf"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if (-not (Test-Path $LocalPbf)) {
    Write-Host "Extracting Greater KL from the source PBF..."
    docker run --rm -t -v "${SourceDir}:/source:ro" -v "${DataDir}:/data" iboates/osmium:latest extract -b $BoundingBox "/source/$SourceName" -o /data/greater-kl.osm.pbf --overwrite
    if ($LASTEXITCODE -ne 0) { throw "osmium extract failed with exit code $LASTEXITCODE" }
}

docker run --rm -t -v "${DataDir}:/data" osrm/osrm-backend:latest osrm-extract -p /opt/car.lua /data/greater-kl.osm.pbf
if ($LASTEXITCODE -ne 0) { throw "osrm-extract failed with exit code $LASTEXITCODE" }
docker run --rm -t -v "${DataDir}:/data" osrm/osrm-backend:latest osrm-partition /data/greater-kl.osrm
if ($LASTEXITCODE -ne 0) { throw "osrm-partition failed with exit code $LASTEXITCODE" }
docker run --rm -t -v "${DataDir}:/data" osrm/osrm-backend:latest osrm-customize --threads 4 /data/greater-kl.osrm
if ($LASTEXITCODE -ne 0) { throw "osrm-customize failed with exit code $LASTEXITCODE" }

Write-Host "OSRM graph ready. Start it with:"
Write-Host "docker compose -f backend/modules/live-dispatch/routing/docker-compose.yml up -d"
