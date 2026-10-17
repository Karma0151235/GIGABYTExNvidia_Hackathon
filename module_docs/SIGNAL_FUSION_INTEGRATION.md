# Signal Fusion integration contract

Signal Fusion is ANWAR's intake and correlation boundary. It converts noisy reports from call centres and other channels into consolidated event clusters, retains duplicate reports as evidence, and publishes a stable incident handoff for Command Center.

## Position in ANWAR

```text
CALL / FIELD / SMS / APP / RADIO / CCTV
                    |
                    v
              Signal Fusion
     normalize + correlate + deduplicate
                    |
                    v
          verified incident handoff
                    |
                    v
              Command Center
                    |
                    v
               Live Dispatch
```

Signal Fusion owns raw reports, semantic and geospatial correlation, cluster evidence, duplicate decisions, operator verification, promotion, and incident-handoff events.

Command Center owns the incident after promotion, including priority overrides, SLA state, acknowledgement, assignment, and response lifecycle. Live Dispatch must consume Command Center incidents rather than reading Signal Fusion clusters directly.

## Module locations

| Area | Location |
| --- | --- |
| Backend API | `backend/modules/signal-fusion/api/router.py` |
| Fusion engine | `backend/modules/signal-fusion/services/fusion_engine.py` |
| Semantic providers | `backend/modules/signal-fusion/services/semantic_provider.py` |
| PostgreSQL store | `backend/modules/signal-fusion/services/store.py` |
| API schemas | `backend/modules/signal-fusion/models/schemas.py` |
| Database migration | `backend/infrastructure/postgres/init/001_signal_fusion.sql` |
| Backend shared types | `backend/shared/contracts/signal_fusion.py` |
| Frontend module | `frontend/modules/signal-fusion/` |
| Frontend shared types | `frontend/shared/contracts/signal-fusion.ts` |

## Correlation engine

Signal Fusion does not depend on a paid embedding API.

1. It first attempts to use a locally cached `sentence-transformers/all-MiniLM-L6-v2` model.
2. If the model or optional dependency is unavailable, it falls back to the deterministic local word-and-character hashing provider.
3. It embeds the report transcript and location, then compares the result with active cluster centroids.
4. Candidate clusters must be within 5 km and no more than 90 minutes old.
5. The fusion score is `72% semantic + 20% geographic + 8% recency`.
6. A score below `0.50` creates a new cluster.
7. A semantic score of at least `0.79` and fusion score of at least `0.74` marks the report as a probable duplicate.
8. Other matching reports are correlated as distinct supporting evidence.

Duplicate reports are not deleted. They remain linked to the cluster for confidence, evidence, auditing, and later review.

Provider selection can be controlled with:

```powershell
$env:SIGNAL_FUSION_EMBEDDING_PROVIDER="hashing"
$env:SIGNAL_FUSION_LOCAL_MODEL="sentence-transformers/all-MiniLM-L6-v2"
```

Use `hashing` for deterministic local tests. No OpenAI key or paid model is required.

## Report ingestion

Use the idempotent ingestion endpoint:

```http
POST /api/signal-fusion/ingest
Content-Type: application/json
```

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

Supported sources are `CALL`, `FIELD`, `SMS`, `APP`, `RADIO`, and `CCTV`.

Always send the source system's stable `external_id`. Repeating an existing ID returns the stored result with `decision.outcome = "replayed"` and does not create a second report.

The response contains the normalized `signal`, consolidated `cluster`, fusion `decision`, scores, provider name, and measured processing latency.

## Operator lifecycle

```text
emerging -> verified -> promoted
    |           |
    +-----------+-> dismissed
```

| Endpoint | Purpose |
| --- | --- |
| `POST /api/signal-fusion/clusters/{id}/verify` | Confirm the cluster as an operational event. |
| `POST /api/signal-fusion/clusters/{id}/dismiss` | Dismiss an emerging or verified cluster. |
| `POST /api/signal-fusion/clusters/{id}/promote-to-incident` | Create the stable Command Center handoff. |
| `POST /api/signal-fusion/clusters/merge` | Merge two unpromoted clusters after operator review. |

Send `X-Operator-Id` for operator actions. Promotion is idempotent and returns the same incident identity when repeated. Promoted clusters cannot be dismissed or merged inside Signal Fusion; reconciliation belongs to Command Center.

## Incident handoff

Promotion creates an `IncidentHandoff` containing:

- Stable incident ID, source cluster ID, and monotonic version.
- Priority, severity, confidence, category, and coordinates.
- Consolidated summary, facts, risks, and recommended actions.
- Source-channel mix, report counts, duplicate counts, and evidence IDs.
- `ready_for_command_center` state and timestamps.

Consumers can read current handoffs from:

```http
GET /api/signal-fusion/incidents
GET /api/signal-fusion/incidents/{incident_id}
```

## Durable event feed

Command Center consumes:

```http
GET /api/signal-fusion/events?after=0&limit=100
```

Published events:

- `signal_fusion.incident.promoted.v1`
- `signal_fusion.incident.updated.v1`

Consumers must persist `next_cursor` only after applying a batch. Delivery is at least once, so upsert by `aggregate_id` and ignore events whose `aggregate_version` is not newer than the stored version.

```python
for event in feed["events"]:
    current = incidents.get(event["aggregate_id"])
    if current is None or event["aggregate_version"] > current.version:
        upsert_incident(event["payload"])

save_cursor(feed["next_cursor"])
```

## PostgreSQL ownership

Signal Fusion owns the `signal_fusion` schema.

| Table | Purpose |
| --- | --- |
| `signal_fusion.signals` | Normalized raw reports, embeddings, and cluster decision state. |
| `signal_fusion.clusters` | Consolidated semantic and geospatial event clusters. |
| `signal_fusion.incident_handoffs` | Stable promoted incidents for Command Center. |
| `signal_fusion.audit_events` | Engine and operator decision history. |
| `signal_fusion.outbox_events` | Transactional downstream event feed. |
| `signal_fusion.schema_migrations` | Applied schema version. |

Other modules must not query these tables directly. Use the HTTP API or shared contracts so internal storage can evolve without breaking downstream work.

## API reference

| Endpoint | Purpose |
| --- | --- |
| `GET /api/signal-fusion/health` | PostgreSQL, provider, thresholds, and engine readiness. |
| `GET /api/signal-fusion/contract` | Machine-readable integration and event versions. |
| `GET /api/signal-fusion/snapshot` | Operator-ready signals, clusters, and calculated statistics. |
| `POST /api/signal-fusion/ingest` | Preferred replay-safe report ingestion. |
| `GET /api/signal-fusion/signals` | Current normalized report feed. |
| `GET /api/signal-fusion/clusters` | Current event clusters. |
| `GET /api/signal-fusion/incidents` | Promoted incident handoffs. |
| `GET /api/signal-fusion/events` | Cursor-based downstream feed. |
| `GET /api/signal-fusion/audit` | Operator and engine audit records. |

OpenAPI documentation is available at `http://127.0.0.1:8000/docs`.

## Local setup

From the repository root:

```powershell
docker compose up -d anwar-postgres
cd backend
uv sync
uv run python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

The base installation uses the hashing provider. To install optional local sentence-transformer support:

```powershell
uv sync --extra ai
```

The sentence-transformer must already exist in the local model cache because the provider loads with `local_files_only=True`. Otherwise the engine automatically falls back to hashing.

Run the module tests with:

```powershell
cd backend
$env:SIGNAL_FUSION_EMBEDDING_PROVIDER="hashing"
uv run python -m pytest modules/signal-fusion/tests/test_fusion_engine.py -q -p no:cacheprovider
```

## Teammate checklist

- Use `POST /ingest` with a stable external ID for every channel adapter.
- Do not send reports directly to Command Center or Live Dispatch.
- Do not treat duplicate reports as deleted data; they remain supporting evidence.
- Use the promoted incident/event contract for downstream modules.
- Persist event cursors and handle repeated delivery idempotently.
- Import shared types rather than internal module models.
- Keep operator identity on verify, dismiss, merge, and promote actions.
- Use coordinates in `[longitude, latitude]` order when passing handoffs to mapping or routing code.
