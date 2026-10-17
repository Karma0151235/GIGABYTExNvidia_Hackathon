from __future__ import annotations

import asyncio
import importlib


module = importlib.import_module("backend.modules.live-dispatch.services.routing_service")


def test_route_maps_osrm_geometry_and_metrics(monkeypatch):
    service = module.RoutingService()
    monkeypatch.setattr(
        service,
        "_get_json",
        lambda _url: {
            "code": "Ok",
            "routes": [
                {
                    "distance": 4321.0,
                    "duration": 612.0,
                    "geometry": {
                        "coordinates": [
                            [101.7006, 3.1727],
                            [101.7047, 3.1714],
                        ]
                    },
                }
            ],
        },
    )

    route = asyncio.run(service.route([[101.7006, 3.1727], [101.7047, 3.1714]]))

    assert route["provider"] == "local-osrm"
    assert route["distance_km"] == 4.32
    assert route["duration_minutes"] == 10.2
    assert len(route["coordinates"]) == 2


def test_unavailable_osrm_is_explicit(monkeypatch):
    service = module.RoutingService()
    monkeypatch.setattr(
        service,
        "_get_json",
        lambda _url: {"code": "NoRoute", "message": "No route found"},
    )

    try:
        asyncio.run(service.route([[101.7, 3.17], [101.8, 3.18]]))
    except module.RoutingUnavailable as exc:
        assert "No route found" in str(exc)
    else:
        raise AssertionError("RoutingUnavailable was not raised")
