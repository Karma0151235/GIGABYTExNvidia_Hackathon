# Signal Fusion integration contract

This document is the handoff boundary between Signal Fusion and the downstream ANWAR modules.

## Ownership

Signal Fusion owns raw reports, semantic/geospatial correlation, duplicate decisions, operator verification, consolidated evidence, and creation of an incident handoff.

Command Center owns the incident after handoff: lifecycle state, SLA timers, escalation, assignment, agency ownership, and the operational audit timeline.

Live Dispatch should consume a Command Center incident, not a raw Signal Fusion cluster. Care Route Optimizer should consume the dispatched incident plus patient/capability context, not Signal Fusion tables.

```text
Channel adapters
    -> POST /api/signal-fusion/ingest
    -> cluster + FusionDecision
    -> operator verify
    -> promote-to-incident
    -> IncidentHandoff + outbox event
    -> Command Center
    -> Live Dispatch
    -> Care Route Optimizer
```

## PostgreSQL storage

Start the database from the repository root:

```powershell
docker compose up -d anwar-postgres
docker compose ps
```

The service is named `anwar-postgres`, the database is `anwar`, and Signal Fusion uses the dedicated `signal_fusion` schema.

| Table | Owner and purpose |
| --- | --- |
| `signal_fusion.signals` | Raw normalized reports and their fusion decision state. |
| `signal_fusion.clusters` | Current semantic/geospatial event clusters and operator-ready brief. |
| `signal_fusion.incident_handoffs` | Immutable identity and latest version of each promoted incident payload. |
| `signal_fusion.audit_events` | Operator and engine decisions for traceability. |
| `signal_fusion.outbox_events` | Durable cross-module events consumed by Command Center. |
| `signal_fusion.schema_migrations` | Applied schema version. |

Downstream modules must not query these tables directly. Consume the API contract so Signal Fusion can change its internal storage without breaking teammates.

## Report ingestion

`POST /api/signal-fusion/ingest`

```json
{
  "source": "CALL",
  "external_id": "CAD-KL-2026-00192",
  "caller": "+60 12-***-118",
  "transcript": "Two vehicles collided and one person is trapped.",
  "location": "Jalan Tun Razak underpass",
  "latitude": 3.1578,
  "longitude": 101.7214,
  "metadata": {
    "agency": "MERS999",
    "channel": "call-centre"
  }
}
```

Always provide the source system's stable `external_id`. Repeating the same ID returns the original result with `decision.outcome = "replayed"` and does not create another report.

The response contains:

- `signal`: normalized stored report.
- `cluster`: current operator-ready event cluster.
- `decision`: `new_cluster`, `correlated`, `duplicate`, or `replayed`, with scores and reasoning.
- `processing_latency_ms`: measured request processing time.

Supported sources are `CALL`, `FIELD`, `SMS`, `APP`, `RADIO`, and `CCTV`.

## Operator workflow

```text
emerging --verify--> verified --promote--> promoted
    |                    |
    +----dismiss---------+
```

Promoted incidents cannot be dismissed or merged inside Signal Fusion. Reconciliation after promotion belongs to Command Center.

```http
POST /api/signal-fusion/clusters/{cluster_id}/verify
POST /api/signal-fusion/clusters/{cluster_id}/dismiss
POST /api/signal-fusion/clusters/{cluster_id}/promote-to-incident
X-Operator-Id: operator-or-service-id
```

Promotion is idempotent. Repeating it returns the same incident identity.

## Downstream incident payload

Promotion returns an `IncidentHandoff` containing:

- Stable incident ID and source cluster ID.
- Monotonic version and `ready_for_command_center` state.
- Priority, severity, confidence, category, and coordinates.
- Consolidated summary, key facts, risk flags, and recommended actions.
- Source mix, signal counts, duplicate counts, and evidence IDs.

Command Center can bootstrap from:

```http
GET /api/signal-fusion/incidents
GET /api/signal-fusion/incidents/{incident_id}
```

## Event feed

Command Center should poll the durable cursor feed:

```http
GET /api/signal-fusion/events?after=0&limit=100
```

Event types:

- `signal_fusion.incident.promoted.v1`: a new incident is ready.
- `signal_fusion.incident.updated.v1`: new evidence changed a promoted incident.

Persist `next_cursor` in Command Center after successfully applying the batch. Event delivery is at least once, so consumers must upsert by `aggregate_id` and ignore an event when `aggregate_version` is not newer than the stored version.

Example consumer logic:

```python
for event in feed["events"]:
    current = incidents.get(event["aggregate_id"])
    if current is None or event["aggregate_version"] > current.version:
        upsert_incident(event["payload"])
save_cursor(feed["next_cursor"])
```

## API discovery

| Endpoint | Purpose |
| --- | --- |
| `GET /api/signal-fusion/health` | Engine, embedding provider, and PostgreSQL readiness. |
| `GET /api/signal-fusion/contract` | Machine-readable integration entry points and event versions. |
| `GET /api/signal-fusion/snapshot` | Realtime operator console state. |
| `POST /api/signal-fusion/ingest` | Preferred idempotent channel ingestion. |
| `GET /api/signal-fusion/incidents` | Current promoted handoffs. |
| `GET /api/signal-fusion/events` | Cursor-based downstream event feed. |
| `GET /api/signal-fusion/audit` | Operator and engine decision log. |

The OpenAPI explorer is available at `http://127.0.0.1:8000/docs` when the backend is running.
