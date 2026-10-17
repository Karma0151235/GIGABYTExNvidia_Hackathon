from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class RoutingUnavailable(RuntimeError):
    pass


class RoutingService:
    def __init__(self) -> None:
        self.base_url = os.getenv("OSRM_BASE_URL", "http://127.0.0.1:5000").rstrip("/")
        seed_path = Path(__file__).resolve().parents[1] / "data" / "seed_locations.json"
        self.seed_data = json.loads(seed_path.read_text(encoding="utf-8"))

    async def health(self) -> bool:
        try:
            await self.route([[101.7006, 3.1727], [101.7047, 3.1714]])
            return True
        except RoutingUnavailable:
            return False

    async def route(self, coordinates: list[list[float]] | list[tuple[float, float]]) -> dict:
        coordinate_path = ";".join(f"{lng:.7f},{lat:.7f}" for lng, lat in coordinates)
        query = urlencode({
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
            "annotations": "false",
        })
        url = f"{self.base_url}/route/v1/driving/{coordinate_path}?{query}"
        payload = await asyncio.to_thread(self._get_json, url)
        routes = payload.get("routes", [])
        if payload.get("code") != "Ok" or not routes:
            raise RoutingUnavailable(payload.get("message", "OSRM returned no route"))

        best = routes[0]
        return {
            "coordinates": best["geometry"]["coordinates"],
            "distance_km": round(best["distance"] / 1000, 2),
            "duration_minutes": round(best["duration"] / 60, 1),
            "provider": "local-osrm",
        }

    async def seed_snapshot(self) -> dict:
        routes = self.seed_data["routes"]
        results = await asyncio.gather(
            *(self._build_seed_route(route) for route in routes),
            return_exceptions=True,
        )
        resolved = [result for result in results if isinstance(result, dict)]
        failed = [
            route["id"]
            for route, result in zip(routes, results, strict=True)
            if isinstance(result, Exception)
        ]
        locations = [
            {
                "id": item["id"],
                "name": item["name"],
                "kind": "hospital"
                if "Hospital" in item["name"] or item["id"] in {"ijn", "umsc"}
                else "ambulance_base",
                "coordinate": item["coordinate"],
                "metadata": {"trauma": item["trauma"], "icu": item["icu"]},
            }
            for item in self.seed_data["hospitals"]
        ]
        return {
            "routing_online": not failed,
            "routing_provider": "local-osrm",
            "dataset": self.seed_data["dataset"],
            "locations": locations,
            "routes": resolved,
            "failed_route_ids": failed,
        }

    async def _build_seed_route(self, seed: dict) -> dict:
        result = await self.route([seed["origin"], seed["destination"]])
        return {
            **result,
            "id": seed["id"],
            "unit_id": seed["unit_id"],
            "incident_id": seed["incident_id"],
            "hospital_id": seed["hospital_id"],
            "color": seed["color"],
        }

    @staticmethod
    def _get_json(url: str) -> dict:
        try:
            request = Request(url, headers={"User-Agent": "ANWAR-Local-Routing/1.0"})
            with urlopen(request, timeout=8) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise RoutingUnavailable(f"Local OSRM is unavailable: {exc}") from exc


routing_service = RoutingService()
