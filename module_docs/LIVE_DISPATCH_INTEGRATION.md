# Live Dispatch integration contract

Live Dispatch owns fleet readiness, unit selection, operator dispatch decisions, and the route lifecycle from the unit's current position to the scene and onward to the receiving hospital. PostgreSQL is authoritative for units, facilities, dispatches, audit history, consumer cursors, and downstream events.

## Ownership boundary

```text
Command Center incident + assignment event
    -> Live Dispatch ranked unit + operator decision + real OSRM route
    -> Care Route Optimizer destination/capacity coordination
```

Use the API or versioned event feed. Do not query the `live_dispatch` PostgreSQL schema from another module.

## Dispatch lifecycle

```text
recommended -> accepted -> en_route -> on_scene -> transporting -> completed
      |            |           |           |              |
      +-> rejected +-----------+-----------+--------------+-> cancelled
```

All mutable dispatch and unit records carry a `version`. Send it as `expected_version`; stale writes return HTTP `409` and must be refreshed before retrying.

## Primary APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /api/live-dispatch/snapshot` | UI-ready incidents, fleet, facilities, recommendations, routes, and calculated stats. |
| `POST /api/live-dispatch/optimize` | Consume the Command Center cursor and rank dispatchable incidents in priority/SLA order. |
| `GET /api/live-dispatch/units` | Authoritative units, crews, equipment, capabilities, readiness, and positions. |
| `PATCH /api/live-dispatch/units/{id}/location` | Persist telemetry and recalculate an active scene route. |
| `GET /api/live-dispatch/facilities` | Hospitals and ambulance bases with capability and capacity state. |
| `GET /api/live-dispatch/dispatches` | Active recommendations and assignments. Add `include_closed=true` for history. |
| `POST /api/live-dispatch/dispatches/{id}/accept` | Commit a recommendation and assign the unit in Command Center. |
| `POST /api/live-dispatch/dispatches/{id}/reject` | Reject and optionally generate the next eligible recommendation. |
| `POST /api/live-dispatch/dispatches/{id}/reassign` | Release the current unit and rank the operator-selected replacement. |
| `POST /api/live-dispatch/dispatches/{id}/backup` | Create a capability-specific backup assignment. |
| `POST /api/live-dispatch/dispatches/{id}/transition` | Advance `en_route`, `on_scene`, `transporting`, or `completed`. |
| `POST /api/live-dispatch/dispatches/{id}/cancel` | Cancel and release the unit. |
| `GET /api/live-dispatch/dispatches/{id}/audit` | Immutable operator and routing decision history. |
| `GET /api/live-dispatch/events?after=0` | Durable downstream cursor feed. |

Send `X-Operator-Id` for operator actions. The optimizer applies hard clinical capability filters before ranking ETA, capability match, readiness, agency alignment, workload, and SLA urgency. It prevents active units from being recommended twice and keeps accepted work stable across later Command Center updates.

## Downstream events

Consumers should persist `next_cursor` and process events idempotently using `aggregate_id` plus `aggregate_version`.

- `live_dispatch.recommendation.created.v1`
- `live_dispatch.dispatch.accepted.v1`
- `live_dispatch.dispatch.en_route.v1`
- `live_dispatch.dispatch.on_scene.v1`
- `live_dispatch.dispatch.transporting.v1`
- `live_dispatch.dispatch.completed.v1`
- `live_dispatch.dispatch.cancelled.v1`
- `live_dispatch.route.recalculated.v1`

Care Route Optimizer should consume accepted and transporting events, then use `incident_id`, `unit_id`, `receiving_facility_id`, and route ETA from the payload. Shared model aliases are available in `backend/shared/contracts/live_dispatch.py` and `frontend/shared/contracts/live-dispatch.ts`.

## Local setup

```powershell
docker compose up -d anwar-postgres
powershell -ExecutionPolicy Bypass -File .\setup-routing.ps1
cd backend
uv sync
uv run python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

The idempotent migration and teammate seed data are in `backend/infrastructure/postgres/init/004_live_dispatch.sql`. Existing PostgreSQL volumes are migrated automatically when the API first initializes Live Dispatch.
