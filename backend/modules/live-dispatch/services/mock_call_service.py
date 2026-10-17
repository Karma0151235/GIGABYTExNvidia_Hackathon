"""Read-only dispatch preview for classified calls from the future ingestion module."""
from __future__ import annotations

import asyncio
from contextlib import closing
from copy import deepcopy
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .routing_service import RoutingUnavailable, routing_service


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
PLACE_INDEX = DATA_DIR / "osm_places.json"
SEED = DATA_DIR / "seed_locations.json"
PREVIEW_DB = DATA_DIR / "ingestion_previews.sqlite3"
MAX_STORED_PREVIEWS = 50


class PlaceNotFound(ValueError):
    pass


def publish_ingestion_preview(preview: dict) -> dict:
    """Persist route geometry so API reloads do not erase processed calls."""
    with closing(_preview_connection()) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT revision FROM preview_state WHERE id = 1").fetchone()
        revision = (row[0] if row else 0) + 1
        published = {**deepcopy(preview), "revision": revision,
                     "received_at": datetime.now(timezone.utc).isoformat()}
        serialized = json.dumps(published)
        connection.execute(
            "INSERT INTO preview_state (id, revision, latest_json) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, latest_json = excluded.latest_json",
            (revision, serialized),
        )
        call_id = published.get("call_id")
        if call_id and published.get("classification") == "legit_distress":
            connection.execute(
                "INSERT INTO distress_previews (call_id, revision, preview_json) VALUES (?, ?, ?) "
                "ON CONFLICT(call_id) DO UPDATE SET revision = excluded.revision, preview_json = excluded.preview_json",
                (call_id, revision, serialized),
            )
            connection.execute(
                "DELETE FROM distress_previews WHERE call_id NOT IN "
                "(SELECT call_id FROM distress_previews ORDER BY revision DESC LIMIT ?)",
                (MAX_STORED_PREVIEWS,),
            )
        return published


def latest_ingestion_preview() -> dict | None:
    with closing(_preview_connection()) as connection:
        row = connection.execute("SELECT latest_json FROM preview_state WHERE id = 1").fetchone()
        return json.loads(row[0]) if row else None


def list_ingestion_previews() -> list[dict]:
    """Newest distress call first; each result includes its own route geometry."""
    with closing(_preview_connection()) as connection:
        rows = connection.execute(
            "SELECT preview_json FROM distress_previews ORDER BY revision DESC LIMIT ?",
            (MAX_STORED_PREVIEWS,),
        ).fetchall()
        return [json.loads(row[0]) for row in rows]


def _preview_connection() -> sqlite3.Connection:
    PREVIEW_DB.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(PREVIEW_DB, timeout=10)
    connection.execute("CREATE TABLE IF NOT EXISTS preview_state "
                       "(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, latest_json TEXT NOT NULL)")
    connection.execute("CREATE TABLE IF NOT EXISTS distress_previews "
                       "(call_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, preview_json TEXT NOT NULL)")
    return connection


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def resolve_place(location_text: str) -> dict:
    if not PLACE_INDEX.exists():
        raise PlaceNotFound("OSM place index is missing. Run setup-routing.ps1 to build it from the local PBF.")
    places = json.loads(PLACE_INDEX.read_text(encoding="utf-8"))
    query = normalize(location_text)
    matches = []
    for place in places:
        name = normalize(place["name"])
        if not name:
            continue
        if name == query:
            matches.append((2, len(name), place))
        elif name in query:
            matches.append((1, len(name), place))
        elif query in name:
            matches.append((0, -len(name), place))
    if not matches:
        raise PlaceNotFound(f"No OSM locality matched '{location_text}'. Supply an exact place name or coordinates.")
    # Prefer the longest locality mentioned in a full address or transcript.
    return max(matches, key=lambda item: item[:2])[2]


async def preview_triage_summary(summary: dict, router=routing_service) -> dict:
    """Adapt signal-fusion triage output without trusting a missing location."""
    classification = {"emergency": "legit_distress", "spam": "scam", "silent": "misc"}[summary["call_class"]]
    location = summary.get("location") or {}
    location_text = (location.get("text") or "").strip()
    latitude, longitude = location.get("lat"), location.get("lng")
    if classification != "legit_distress":
        return {"call_id": summary["call_id"], "classification": classification, "routable": False,
                "reason": "Triage did not classify this call as an emergency."}
    if not location_text and (latitude is None or longitude is None):
        return {"call_id": summary["call_id"], "classification": classification, "routable": False,
                "reason": "Incident location is unresolved; ask the caller for a location before route planning."}
    try:
        return await preview_call({
            "call_id": summary["call_id"], "classification": classification,
            "location_text": location_text or "Caller-provided coordinates",
            "latitude": latitude, "longitude": longitude,
            "incident": {"title": summary.get("complaint") or "Emergency call",
                         "summary": summary.get("complaint"), "priority": summary.get("priority")},
        }, router)
    except (PlaceNotFound, RoutingUnavailable) as exc:
        return {"call_id": summary["call_id"], "classification": classification, "routable": False,
                "reason": str(exc)}


async def preview_call(payload: dict, router=routing_service) -> dict:
    classification = payload["classification"]
    if classification != "legit_distress":
        return {"classification": classification, "routable": False, "reason": "Only legitimate distress calls receive an ambulance route."}

    location_text = payload["location_text"].strip()
    if payload.get("longitude") is not None and payload.get("latitude") is not None:
        coordinate = [payload["longitude"], payload["latitude"]]
        resolution = "provided_coordinate"
        matched_place = None
    else:
        place = resolve_place(location_text)
        coordinate = place["coordinate"]
        resolution = "osm_locality"
        matched_place = place["name"]

    units = json.loads(SEED.read_text(encoding="utf-8"))["routes"]
    routed = await asyncio.gather(
        *(router.route([unit["origin"], coordinate]) for unit in units),
        return_exceptions=True,
    )
    candidates = []
    for unit, route in zip(units, routed, strict=True):
        if isinstance(route, Exception):
            continue
        candidates.append({
            "unit_id": unit["unit_id"], "origin_coordinate": unit["origin"],
            "eta_minutes": route["duration_minutes"], "distance_km": route["distance_km"],
            "coordinates": route["coordinates"],
        })
    if not candidates:
        raise RoutingUnavailable("No simulated ambulance can reach this location on the local OSRM graph.")
    candidates.sort(key=lambda item: (item["eta_minutes"], item["distance_km"]))
    return {
        "classification": classification, "routable": True,
        "call_id": payload.get("call_id") or "MOCK-CALL",
        "location_text": payload.get("display_location") or location_text,
        "incident": payload.get("incident") or {"title": "Mock distress call", "priority": "P2"},
        "incident_coordinate": coordinate,
        "road_access_coordinate": candidates[0]["coordinates"][-1],
        "resolution": resolution, "matched_place": matched_place,
        "selected": candidates[0], "alternatives": [
            {key: item[key] for key in ("unit_id", "eta_minutes", "distance_km")}
            for item in candidates[1:]
        ],
        "reason": "Preview only. An operator must approve a real dispatch.",
    }
