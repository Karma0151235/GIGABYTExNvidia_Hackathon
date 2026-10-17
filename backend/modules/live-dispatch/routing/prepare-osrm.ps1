param(
    [string]$PbfPath = "../../../../osm-data/malaysia-singapore-brunei-260712.osm.pbf",
    [string]$BoundingBox = "101.35,2.85,101.95,3.40"
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
$ExtractMarker = Join-Path $DataDir "extract-bbox.txt"
$NeedsExtract = -not (Test-Path -LiteralPath $LocalPbf) -or -not (Test-Path -LiteralPath $ExtractMarker) -or (Get-Content -LiteralPath $ExtractMarker -Raw).Trim() -ne $BoundingBox
$PlaceIndex = Join-Path $RoutingDir "..\data\osm_places.json"
$PlaceGeoJson = Join-Path $DataDir "places.geojson"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if ($NeedsExtract) {
    Write-Host "Extracting Greater KL from the source PBF..."
    docker run --rm -t -v "${SourceDir}:/source:ro" -v "${DataDir}:/data" iboates/osmium:latest extract -b $BoundingBox "/source/$SourceName" -o /data/greater-kl.osm.pbf --overwrite
    if ($LASTEXITCODE -ne 0) { throw "osmium extract failed with exit code $LASTEXITCODE" }
}

if ($NeedsExtract -or -not (Test-Path -LiteralPath $PlaceIndex)) {
    Write-Host "Building OSM locality index from the regional extract..."
    docker run --rm -v "${DataDir}:/data" iboates/osmium:latest tags-filter -R /data/greater-kl.osm.pbf n/place -o /data/places.osm.pbf -O
    if ($LASTEXITCODE -ne 0) { throw "osmium tags-filter failed with exit code $LASTEXITCODE" }
    docker run --rm -v "${DataDir}:/data" iboates/osmium:latest export /data/places.osm.pbf -o /data/places.geojson -u type_id -O
    if ($LASTEXITCODE -ne 0) { throw "osmium export failed with exit code $LASTEXITCODE" }
    python (Join-Path $RoutingDir "build-place-index.py") $PlaceGeoJson $PlaceIndex
    if ($LASTEXITCODE -ne 0) { throw "OSM place index generation failed with exit code $LASTEXITCODE" }
}

if ($NeedsExtract -or -not (Test-Path -LiteralPath (Join-Path $DataDir "greater-kl.osrm.cell_metrics"))) {
    docker run --rm -t -v "${DataDir}:/data" osrm/osrm-backend:latest osrm-extract -p /opt/car.lua /data/greater-kl.osm.pbf
    if ($LASTEXITCODE -ne 0) { throw "osrm-extract failed with exit code $LASTEXITCODE" }
    docker run --rm -t -v "${DataDir}:/data" osrm/osrm-backend:latest osrm-partition /data/greater-kl.osrm
    if ($LASTEXITCODE -ne 0) { throw "osrm-partition failed with exit code $LASTEXITCODE" }
    docker run --rm -t -v "${DataDir}:/data" osrm/osrm-backend:latest osrm-customize --threads 4 /data/greater-kl.osrm
    if ($LASTEXITCODE -ne 0) { throw "osrm-customize failed with exit code $LASTEXITCODE" }
}
Set-Content -LiteralPath $ExtractMarker -Value $BoundingBox -NoNewline

Write-Host "OSRM graph ready. Start it with:"
Write-Host "docker compose -f backend/modules/live-dispatch/routing/docker-compose.yml up -d"
