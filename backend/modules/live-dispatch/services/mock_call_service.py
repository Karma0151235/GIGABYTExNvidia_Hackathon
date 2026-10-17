"""Read-only dispatch preview for classified calls from the future ingestion module."""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from .routing_service import RoutingUnavailable, routing_service


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
PLACE_INDEX = DATA_DIR / "osm_places.json"
SEED = DATA_DIR / "seed_locations.json"
_latest_lock = Lock()
_latest_preview: dict | None = None
_revision = 0


class PlaceNotFound(ValueError):
    pass


def publish_ingestion_preview(preview: dict) -> dict:
    """Expose the latest teammate handoff to the demo UI in this API process."""
    global _latest_preview, _revision
    with _latest_lock:
        _revision += 1
        _latest_preview = {**preview, "revision": _revision, "received_at": datetime.now(timezone.utc).isoformat()}
        return _latest_preview.copy()


def latest_ingestion_preview() -> dict | None:
    with _latest_lock:
        return _latest_preview.copy() if _latest_preview else None


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
