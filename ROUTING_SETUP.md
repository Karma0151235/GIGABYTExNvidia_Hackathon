# ANWAR local routing setup

ANWAR uses a local OSRM service built from OpenStreetMap data. The source PBF is not a browser tile bundle; the setup extracts the Greater Kuala Lumpur drivable road graph and calculates real route geometry, distance, and travel time.

## Prerequisites

- Docker Desktop with the Linux engine running.
- Python 3.11 or newer for the ANWAR backend.
- Node.js 20 or newer for the frontend.
- The shared malaysia-singapore-brunei-260712.osm.pbf file.

## First-time setup

1. Clone the repository.
2. Place the PBF at osm-data/malaysia-singapore-brunei-260712.osm.pbf.
3. Open PowerShell in the repository root.
4. Run:

       powershell -ExecutionPolicy Bypass -File .\setup-routing.ps1

The script downloads the required Docker images, creates the ignored local graph under backend/modules/live-dispatch/routing/routing-data, starts OSRM, and verifies a route. Subsequent runs reuse the existing graph.

## Run ANWAR

Start the backend:

    python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000

Start the frontend in another terminal:

    cd frontend
    npm install
    npm run dev

Open http://localhost:3000, select **Live Dispatch**, and confirm the map shows LOCAL OSM / 10 ROAD ROUTES.

## Useful commands

Start routing again after Docker or the computer restarts:

    powershell -ExecutionPolicy Bypass -File .\setup-routing.ps1

Check the routing container:

    docker compose -f backend/modules/live-dispatch/routing/docker-compose.yml ps

Stop local routing:

    docker compose -f backend/modules/live-dispatch/routing/docker-compose.yml stop
