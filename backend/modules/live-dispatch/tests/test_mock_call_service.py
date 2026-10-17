from __future__ import annotations

import asyncio
import importlib
import json

import pytest
from pydantic import ValidationError


module = importlib.import_module("backend.modules.live-dispatch.services.mock_call_service")
schemas = importlib.import_module("backend.modules.live-dispatch.models.schemas")
api = importlib.import_module("backend.modules.live-dispatch.api.router")


class FakeRouter:
    async def route(self, coordinates):
        origin, destination = coordinates
        return {
            "coordinates": [origin, destination],
            "distance_km": abs(origin[0] - destination[0]) * 100,
            "duration_minutes": abs(origin[0] - destination[0]) * 1000,
        }


def mock_index(monkeypatch, places):
    class Index:
        @staticmethod
        def exists():
            return True

        @staticmethod
        def read_text(encoding):
            return json.dumps(places)

    monkeypatch.setattr(module, "PLACE_INDEX", Index())


def test_locality_from_osm_index_is_routed_and_ranked(monkeypatch):
    mock_index(monkeypatch, [
        {"name": "Puchong", "coordinate": [101.61, 3.03]},
        {"name": "Bandar Sunway", "coordinate": [101.62, 3.07]},
    ])
    result = asyncio.run(module.preview_call({
        "classification": "legit_distress", "location_text": "Car accident at Bandar Sunway, leg injured",
    }, FakeRouter()))
    assert result["incident_coordinate"] == [101.62, 3.07]
    assert result["matched_place"] == "Bandar Sunway"
    assert result["selected"]["eta_minutes"] <= result["alternatives"][0]["eta_minutes"]
    assert result["selected"]["coordinates"][-1] == [101.62, 3.07]
    assert result["road_access_coordinate"] == result["selected"]["coordinates"][-1]


def test_non_distress_call_never_requests_route():
    class ForbiddenRouter:
        async def route(self, coordinates):
            raise AssertionError("scam call must not route")

    result = asyncio.run(module.preview_call({
        "classification": "scam", "location_text": "Puchong",
    }, ForbiddenRouter()))
    assert result["routable"] is False


def test_precise_coordinates_override_locality_lookup(monkeypatch):
    monkeypatch.setattr(module, "PLACE_INDEX", type("MissingIndex", (), {"exists": lambda self: False})())
    result = asyncio.run(module.preview_call({
        "classification": "legit_distress", "location_text": "Specific road address",
        "longitude": 101.64, "latitude": 3.05,
    }, FakeRouter()))
    assert result["resolution"] == "provided_coordinate"
    assert result["incident_coordinate"] == [101.64, 3.05]


def test_unknown_place_does_not_guess(monkeypatch):
    mock_index(monkeypatch, [])
    with pytest.raises(module.PlaceNotFound):
        module.resolve_place("Some unknown road")


def test_ingestion_json_reaches_router_with_incident_and_geolocation(monkeypatch):
    mock_index(monkeypatch, [{"name": "Bandar Sunway", "coordinate": [101.62, 3.07]}])
    original_preview = module.preview_call

    async def preview(payload):
        return await original_preview(payload, FakeRouter())

    monkeypatch.setattr(api.mock_call_module, "preview_call", preview)
    request = schemas.IngestionResultRequest(
        call_id="CALL-42", classification="legit_distress",
        geolocation={"locality": "Bandar Sunway", "address": "Jalan PJS 11, Bandar Sunway"},
        incident={"title": "Road traffic accident", "summary": "Leg injury", "priority": "P2"},
    )
    result = asyncio.run(api.ingestion_preview(request))
    assert result["call_id"] == "CALL-42"
    assert result["incident"]["title"] == "Road traffic accident"
    assert result["incident_coordinate"] == [101.62, 3.07]
    assert result["location_text"] == "Jalan PJS 11, Bandar Sunway"
    assert result["selected"]["coordinates"][-1] == result["road_access_coordinate"]
    assert result["revision"] >= 1
    assert asyncio.run(api.latest_ingestion_preview())["call_id"] == "CALL-42"


def test_valid_distress_requires_location_and_incident():
    with pytest.raises(ValidationError):
        schemas.IngestionResultRequest(call_id="CALL-42", classification="legit_distress")
    with pytest.raises(ValidationError):
        schemas.IngestedGeolocation(locality="Puchong", latitude=3.03)
