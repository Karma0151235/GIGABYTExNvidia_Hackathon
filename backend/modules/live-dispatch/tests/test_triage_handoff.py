"""The intake summary must route without a manually rewritten JSON payload."""
from __future__ import annotations

import asyncio
from importlib import import_module

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError


triage_api = import_module("backend.modules.signal-fusion.api.router")
triage_schemas = import_module("backend.modules.signal-fusion.models.schemas")
dispatch_api = import_module("backend.modules.live-dispatch.api.router")
places = import_module("backend.modules.live-dispatch.services.mock_call_service")


@pytest.fixture(autouse=True)
def isolated_preview_store(monkeypatch, tmp_path):
    monkeypatch.setattr(places, "PREVIEW_DB", tmp_path / "ingestion_previews.sqlite3")
    monkeypatch.setattr(triage_api.triage_service, "_llm_client", lambda: (None, None))


class FakeRouter:
    async def route(self, coordinates):
        origin, destination = coordinates
        return {"coordinates": [origin, destination], "distance_km": 2.5, "duration_minutes": 6.0}


def test_emergency_summary_routes_to_osm_place_and_preserves_priority(monkeypatch):
    seen = []
    monkeypatch.setattr(triage_api.engine, "ingest_report", lambda signal: seen.append(signal) or {"test": True})
    monkeypatch.setattr(places, "resolve_place", lambda text: {"name": "Puchong", "coordinate": [101.61, 3.03]})
    original_preview = places.preview_triage_summary

    async def preview_with_fake_router(summary):
        return await original_preview(summary, FakeRouter())

    monkeypatch.setattr(places, "preview_triage_summary", preview_with_fake_router)

    triaged = asyncio.run(triage_api.triage_call(triage_schemas.TriageRequest(
        transcript="Car accident at Puchong, patient has a broken leg",
    )))
    summary = triaged["summary"]
    assert summary["call_class"] == "emergency"
    assert summary["priority"] == "P2"
    assert summary["location"]["text"] == "Puchong"
    assert summary["location"]["lat"] == 3.03
    assert seen[0]["severity"] == 80
    assert seen[0]["external_id"] == summary["call_id"]

    preview = triaged["dispatch_preview"]
    assert preview["routable"] is True
    assert preview["incident_coordinate"] == [101.61, 3.03]
    assert preview["incident"]["priority"] == "P2"
    assert preview["selected"]["coordinates"][-1] == [101.61, 3.03]


@pytest.mark.parametrize("transcript,classification", [
    ("(silence)", "misc"),
    ("hahaha prank call je, saja test line 999", "scam"),
])
def test_filtered_calls_never_enter_fusion_or_request_a_route(monkeypatch, transcript, classification):
    monkeypatch.setattr(triage_api.engine, "ingest_report", lambda signal: pytest.fail("filtered call entered fusion"))
    summary = asyncio.run(triage_api.triage_call(triage_schemas.TriageRequest(transcript=transcript)))["summary"]
    preview = asyncio.run(places.preview_triage_summary(summary, FakeRouter()))
    assert preview["classification"] == classification
    assert preview["routable"] is False


def test_unresolved_emergency_does_not_become_a_kl_centre_incident(monkeypatch):
    monkeypatch.setattr(places, "resolve_place", lambda text: (_ for _ in ()).throw(places.PlaceNotFound(text)))
    monkeypatch.setattr(triage_api.engine, "ingest_report", lambda signal: pytest.fail("unlocated call entered fusion"))
    summary = asyncio.run(triage_api.triage_call(triage_schemas.TriageRequest(
        transcript="Someone collapsed and is unconscious, please hurry",
    )))["summary"]
    assert "location" in summary["missing"]
    assert summary["location"]["lat"] is None
    preview = asyncio.run(places.preview_triage_summary(summary, FakeRouter()))
    assert preview["routable"] is False


def test_unmatched_location_clears_dispatch_preview(monkeypatch):
    monkeypatch.setattr(places, "resolve_place", lambda text: (_ for _ in ()).throw(places.PlaceNotFound(text)))
    summary = {"call_id": "CALL-404", "call_class": "emergency", "priority": "P2",
               "location": {"text": "Unknown junction", "lat": None, "lng": None}, "complaint": "Collision"}
    preview = asyncio.run(places.preview_triage_summary(summary, FakeRouter()))
    assert preview["call_id"] == "CALL-404"
    assert preview["routable"] is False
    assert "Unknown junction" in preview["reason"]


def test_klcc_audio_summary_uses_supplied_coordinates_and_p1_priority():
    summary = {"call_id": "CALL-7CD6F580", "call_class": "emergency", "priority": "P1",
               "location": {"text": "klcc", "area": "Kuala Lumpur", "lat": 3.1579, "lng": 101.7123},
               "complaint": "Caller reports his father collapsed and is unresponsive"}
    preview = asyncio.run(places.preview_triage_summary(summary, FakeRouter()))
    assert preview["routable"] is True
    assert preview["resolution"] == "provided_coordinate"
    assert preview["incident_coordinate"] == [101.7123, 3.1579]
    assert preview["incident"]["priority"] == "P1"


def test_triage_preview_endpoint_accepts_exact_intake_summary(monkeypatch):
    async def fake_preview(summary):
        assert summary["call_id"] == "CALL-123"
        return {"call_id": summary["call_id"], "classification": "misc", "routable": False, "reason": "silent"}

    monkeypatch.setattr(places, "preview_triage_summary", fake_preview)
    summary = triage_schemas.TriageSummary(
        call_id="CALL-123", received_at="2026-10-17T00:00:00+00:00", call_class="silent",
        priority=None, location=None, patients=None, conscious=None, breathing=None,
        complaint=None, missing=[], transcript="", audio_url=None,
    )
    result = asyncio.run(dispatch_api.triage_preview(summary))
    assert result["call_id"] == "CALL-123"
    assert result["revision"] >= 1


def test_processed_audio_publishes_route_for_live_dispatch(monkeypatch):
    from backend.server import app

    monkeypatch.setattr(triage_api.triage_service, "transcribe_sample",
                        lambda name: "Car accident at Puchong, patient has a broken leg")
    monkeypatch.setattr(triage_api.engine, "ingest_report", lambda signal: None)
    monkeypatch.setattr(places, "resolve_place", lambda text: {"name": "Puchong", "coordinate": [101.61, 3.03]})
    original_preview = places.preview_triage_summary

    async def preview_with_fake_router(summary):
        return await original_preview(summary, FakeRouter())

    monkeypatch.setattr(places, "preview_triage_summary", preview_with_fake_router)
    client = TestClient(app)
    intake = client.post("/api/signal-fusion/triage", json={"sample": "mock-call.mp3"})
    assert intake.status_code == 201, intake.text
    summary = intake.json()["summary"]
    assert summary["audio_url"].endswith("mock-call.mp3")
    assert intake.json()["dispatch_preview"]["routable"] is True
    latest = client.get("/api/live-dispatch/ingestion/latest")
    assert latest.status_code == 200
    assert latest.json()["call_id"] == summary["call_id"]
    assert latest.json()["selected"]["coordinates"][-1] == [101.61, 3.03]


def test_multiple_audio_calls_keep_separate_selectable_routes(monkeypatch):
    from backend.server import app

    transcripts = {
        "klcc.mp3": "My father collapsed and is unconscious at KLCC",
        "puchong.mp3": "Car accident at Puchong, patient has a broken leg",
    }
    monkeypatch.setattr(triage_api.triage_service, "transcribe_sample", lambda name: transcripts[name])
    monkeypatch.setattr(triage_api.engine, "ingest_report", lambda signal: None)
    monkeypatch.setattr(places, "resolve_place", lambda text: {"name": "Puchong", "coordinate": [101.61, 3.03]})
    original_preview = places.preview_triage_summary

    async def preview_with_fake_router(summary):
        return await original_preview(summary, FakeRouter())

    monkeypatch.setattr(places, "preview_triage_summary", preview_with_fake_router)
    client = TestClient(app)
    first = client.post("/api/signal-fusion/triage", json={"sample": "klcc.mp3"})
    second = client.post("/api/signal-fusion/triage", json={"sample": "puchong.mp3"})
    assert first.status_code == second.status_code == 201
    feed = client.get("/api/live-dispatch/ingestion/previews")
    assert feed.status_code == 200
    routes = feed.json()
    assert [item["call_id"] for item in routes] == [
        second.json()["summary"]["call_id"], first.json()["summary"]["call_id"],
    ]
    assert [item["incident"]["priority"] for item in routes] == ["P2", "P1"]
    assert routes[0]["incident_coordinate"] == [101.61, 3.03]
    assert routes[1]["incident_coordinate"] == [101.7123, 3.1579]
    assert routes[0]["selected"]["coordinates"][-1] != routes[1]["selected"]["coordinates"][-1]


def test_preview_store_updates_same_call_and_bounds_history(monkeypatch):
    monkeypatch.setattr(places, "MAX_STORED_PREVIEWS", 2)
    for call_id in ("CALL-A", "CALL-B", "CALL-A", "CALL-C"):
        places.publish_ingestion_preview({"call_id": call_id, "classification": "legit_distress",
                                          "routable": True, "incident_coordinate": [101.7, 3.1]})
    assert [item["call_id"] for item in places.list_ingestion_previews()] == ["CALL-C", "CALL-A"]
    places.publish_ingestion_preview({"call_id": "CALL-SPAM", "classification": "scam", "routable": False})
    assert [item["call_id"] for item in places.list_ingestion_previews()] == ["CALL-C", "CALL-A"]


def test_audio_route_preview_survives_fusion_storage_outage(monkeypatch):
    monkeypatch.setattr(places, "resolve_place", lambda text: {"name": "Puchong", "coordinate": [101.61, 3.03]})

    def unavailable(signal):
        raise triage_api.StorageUnavailable("database offline")

    monkeypatch.setattr(triage_api.engine, "ingest_report", unavailable)
    original_preview = places.preview_triage_summary

    async def preview_with_fake_router(summary):
        return await original_preview(summary, FakeRouter())

    monkeypatch.setattr(places, "preview_triage_summary", preview_with_fake_router)
    result = asyncio.run(triage_api.triage_call(triage_schemas.TriageRequest(
        transcript="Car accident at Puchong, patient has a broken leg",
    )))
    assert result.get("ingestion") is None
    assert result["ingestion_error"] == "database offline"
    assert result["dispatch_preview"]["routable"] is True


def test_triage_coordinates_must_be_supplied_as_a_pair():
    with pytest.raises(ValidationError):
        triage_schemas.TriageRequest(transcript="Collision in Puchong", latitude=3.03)
