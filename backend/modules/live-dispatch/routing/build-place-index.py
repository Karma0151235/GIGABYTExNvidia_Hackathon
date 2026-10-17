"""Convert OSM place node GeoJSON into a small local name/coordinate index."""
import json
import sys
from pathlib import Path


source, destination = map(Path, sys.argv[1:3])
features = json.loads(source.read_text(encoding="utf-8"))["features"]
places = []
for feature in features:
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    name = properties.get("name")
    coordinate = geometry.get("coordinates")
    if name and geometry.get("type") == "Point" and coordinate and len(coordinate) >= 2:
        places.append({"name": name, "coordinate": coordinate[:2], "osm_id": feature.get("id")})
places.sort(key=lambda item: item["name"].casefold())
destination.write_text(json.dumps(places, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Indexed {len(places)} OSM place nodes in {destination}")
