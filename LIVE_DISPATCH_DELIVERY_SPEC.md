# Live Dispatch Delivery Specification

## Objective

Make Live Dispatch a downstream consumer of promoted Signal Fusion incidents, then use local OSRM road routing to rank seeded ambulances and candidate hospitals. It is decision support only: this work must not create a dispatch assignment or claim live hospital capacity.

## Scope and ownership

| Concern | Owner for this delivery | Source of truth |
| --- | --- | --- |
| Incident identity, summary, priority, severity, coordinates, actions, version | Signal Fusion | `GET /api/signal-fusion/incidents` |
| Unit availability, capability, and origin | Live Dispatch seed data | Versioned JSON seed file |
| Hospital capability and simulated availability | Live Dispatch seed data | Versioned JSON seed file |
| Road geometry, ETA, distance | Local OSRM | `POST /api/live-dispatch/route` |
| Recommendation and comparison | Live Dispatch | Derived, never persisted as an assignment |

Live Dispatch must use the Signal Fusion HTTP contract only. It must not import Signal Fusion storage code or query `signal_fusion.*` tables. The existing integration document describes Command Center as the normal owner after handoff; this delivery deliberately makes Live Dispatch a read-only API consumer of the same promoted handoff, as required for the prototype.

## Contract rules

- Accept only incidents in state `ready_for_command_center`.
- Preserve `id` and `version` with every recommendation. A newer version replaces an older one; an equal or older version is ignored.
- Treat coordinates as `[longitude, latitude]` when calling Live Dispatch routing.
- A Signal Fusion or OSRM outage is explicit (`503`); never replace it with fabricated incidents or straight-line ETAs.
- `priority` is ordered `P1`, `P2`, `P3`, `P4`; ties sort by severity descending, then `first_reported_at` ascending.
- A recommendation does not dispatch a unit, reserve a hospital bed, or update availability.

## Phase 0 — Make local routing runnable

**Outcome:** Every developer can produce a real OSRM route before dispatch logic is enabled.

1. Place `malaysia-singapore-brunei-260712.osm.pbf` in `osm-data/`.
2. Run `setup-routing.ps1`; it creates the Greater KL graph and starts OSRM on port 5000.
3. Confirm `GET /api/live-dispatch/health` reports `routing_online: true`.
4. Retain `POST /api/live-dispatch/route` as the single OSRM façade; its input remains a list of `[longitude, latitude]` coordinates.

**Acceptance:** a request using two KL coordinates returns OSRM geometry, non-zero distance, and non-zero duration. No dispatch feature may silently use an approximate route when this fails.

## Phase 1 — Read promoted incidents through the API boundary

**Outcome:** Live Dispatch has a small Signal Fusion HTTP client and an internal, read-only incident view.

1. Add `SIGNAL_FUSION_API_BASE_URL` (default `http://127.0.0.1:8000`) to backend configuration.
2. Fetch `GET {base}/api/signal-fusion/incidents` with a bounded timeout.
3. Map only the documented handoff fields: `id`, `version`, `summary`, `priority`, `severity`, `latitude`, `longitude`, `recommended_actions`, plus fields needed for display and ordering.
4. Expose `GET /api/live-dispatch/incidents`, returning that mapped list in the required priority order.
5. Keep the client isolated in Live Dispatch. The frontend consumes the Live Dispatch endpoint, never Signal Fusion tables or an undocumented schema.

**Acceptance:** a promoted Signal Fusion incident appears with identical ID, version, priority, severity, summary, coordinates, and recommended actions. Updating its Signal Fusion version is reflected on the next fetch.

## Phase 2 — Consolidate prototype resource data

**Outcome:** Candidate units and hospitals are available to the backend without pretending they are live operational data.

1. Replace fixed precomputed route seeds with one Live Dispatch seed file containing:
   - `units`: ID, origin `[lng, lat]`, status, capabilities, and display name.
   - `hospitals`: ID, coordinates, capabilities, and `availability: "simulated"`.
2. Include only units with `status: "available"` in normal recommendations.
3. Filter hospitals by the incident’s declared requirement rule and retain simulated capability only. Do not expose a made-up live occupancy percentage.
4. Label all responses and UI values derived from this file as `source: "seed"` / `availability: "simulated"`.

**Acceptance:** a recommendation contains candidates from this one backend seed source. No frontend-only ambulance list affects its result.

## Phase 3 — Calculate road-based comparisons

**Outcome:** Dispatcher recommendations are deterministic and based on OSRM road paths.

For an incident and each eligible seeded unit:

1. Call `POST /api/live-dispatch/route` with `[unit.origin, [incident.longitude, incident.latitude]]`.
2. Record `unit_to_incident` geometry, distance, and ETA.
3. Sort qualified units by ETA ascending, then distance ascending, then unit ID.

For each eligible seeded hospital:

1. Call `POST /api/live-dispatch/route` with `[[incident.longitude, incident.latitude], hospital.coordinate]`.
2. Record `incident_to_hospital` geometry, distance, and ETA.
3. Sort by ETA ascending, then distance ascending, then hospital ID.

Expose the comparison as:

```http
POST /api/live-dispatch/recommendations
Content-Type: application/json

{"incident_id":"INC-1234","incident_version":3}
```

The response includes the incident handoff subset, `recommended_unit`, `unit_candidates`, `recommended_hospital`, `hospital_candidates`, both route legs, source/version metadata, and a human-readable reason such as “fastest eligible seeded ALS unit.” It returns `409` when the submitted version is stale and `503` when either required upstream service is unavailable.

**Acceptance:** test data with a geographically closer but ineligible unit proves that it is excluded; the best candidate has the lowest OSRM ETA among eligible candidates. The selected hospital route starts at the incident coordinate, not the ambulance origin.

## Phase 4 — Present priority and route evidence

**Outcome:** The dispatch screen explains, rather than hides, the recommendation.

1. Replace the static incident list in Live Dispatch with `GET /api/live-dispatch/incidents`.
2. Display Signal Fusion summary, priority, severity, recommended actions, and handoff version.
3. Selecting an incident requests its recommendation and renders the two distinct legs: unit → incident and incident → hospital.
4. Show the top alternatives with OSRM ETA/distance and the exclusion reason for ineligible units.
5. Preserve an operator “recommendation only” label; no Accept button changes state in this phase.

**Acceptance:** changing the incident selection visibly changes the candidate routes and the priority queue is P1-first.

## Phase 5 — Verification and failure handling

**Outcome:** The contract is protected without requiring a production database.

Required automated checks:

1. Signal Fusion client maps the documented handoff and never accesses a database.
2. Priority ordering handles all four priorities, severity ties, and report-time ties.
3. Route requests preserve longitude-first order.
4. Unit and hospital comparison uses separate OSRM legs.
5. Stale incident versions return `409`; unavailable Signal Fusion or OSRM returns `503` with a recovery message.
6. One end-to-end local check: promote a Signal Fusion incident, start OSRM, retrieve it through Live Dispatch, and receive seeded unit and hospital alternatives with real road metrics.

## Phase 6 — Replace seeds when operational tables arrive

**Outcome:** Integration becomes live without changing the Signal Fusion or OSRM contracts.

Replace the seed repository behind a small Live Dispatch resource provider with `units`, `hospitals`, and `dispatch_assignments` tables. Preserve the resource shape and endpoint responses. Add assignment creation only after those tables define ownership, transaction rules, audit fields, and concurrency behaviour.

## Explicit non-goals for this delivery

- Direct Signal Fusion database access.
- Signal Fusion becoming a routing engine.
- Live traffic, road closures, live hospital capacity, bed reservation, or assignment persistence.
- Automatic dispatch, hospital pre-alerts, or AI inference beyond the documented deterministic ranking rules.
