# Command Center integration contract

Command Center is the operational owner of an incident after Signal Fusion promotion. It consumes the versioned Signal Fusion event feed, persists lifecycle and SLA state, records operator decisions, and publishes durable events for downstream modules.

## Ownership boundary

```text
Signal Fusion IncidentHandoff
    -> Command Center incident + SLA + operator state
    -> Live Dispatch assignment and road route
    -> Care Route Optimizer destination decision
```

Downstream modules must use `GET /api/command-center/incidents` or the cursor feed at `GET /api/command-center/events?after=0`. Do not query the `command_center` PostgreSQL schema directly.

## Lifecycle

```text
new -> acknowledged -> assigned -> en_route -> on_scene -> transporting -> resolved
  |          |             |           |           |
  +----------+-------------+-----------+-----------+-> cancelled
```

Every write accepts `expected_version`. A stale version returns HTTP `409`; refresh the incident before retrying.

## Operator endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/command-center/incidents/{id}/acknowledge` | Accept operator ownership. |
| `POST /api/command-center/incidents/{id}/assign` | Assign or replace a unit and destination. |
| `POST /api/command-center/incidents/{id}/transition` | Advance the response lifecycle. |
| `POST /api/command-center/incidents/{id}/priority` | Override priority with a required reason. |
| `GET /api/command-center/incidents/{id}/timeline` | Read the immutable decision timeline. |

Use `X-Operator-Id` on writes. Command Center preserves reasoned priority overrides when later Signal Fusion evidence updates the incident.

## Dispatch consumption

Live Dispatch should retain a durable `next_cursor` and process Command Center events idempotently by `aggregate_id` and `aggregate_version`. The `command_center.incident.assigned.v1` event contains the stable incident, unit, and receiving-hospital identifiers needed to calculate a route and publish dispatch state.
