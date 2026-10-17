"""Oracle demo seed: inject weak signals so risk zones appear before the staged call.

Usage: uv run python scripts/oracle_demo.py   (API must be running on :8000)

Demo flow after running this:
1. Signal Fusion page shows Oracle watch zones (Bukit Bintang rainfall, Chow Kit congestion).
2. Use "AI call triage" with the sample Manglish call (Bukit Bintang) —
   the new cluster is stamped "Oracle anticipated this incident N min before first report".
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timezone

API = "http://127.0.0.1:8000"

RISK_SIGNALS = [
    {
        "source": "rainfall",
        "zone": "Bukit Bintang",
        "latitude": 3.1468,
        "longitude": 101.7113,
        "severity": 84,
        "evidence": {"rain_mm_per_hour": 48, "drain_capacity_percent": 91},
        "validity_minutes": 45,
    },
    {
        # second weak signal in the same zone escalates Bukit Bintang to "high" -> stage_unit
        "source": "congestion",
        "zone": "Bukit Bintang",
        "latitude": 3.1470,
        "longitude": 101.7118,
        "severity": 66,
        "evidence": {"speed_drop_percent": 55, "flooded_lane_reports": 2},
        "validity_minutes": 45,
    },
    {
        "source": "congestion",
        "zone": "Chow Kit",
        "latitude": 3.1637,
        "longitude": 101.6982,
        "severity": 76,
        "evidence": {"speed_drop_percent": 62, "unusual_for_hour": True},
        "validity_minutes": 45,
    },
]


def post(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)


def main() -> int:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for signal in RISK_SIGNALS:
        result = post("/api/signal-fusion/risk-signals", {**signal, "observed_at": now})
        risk = result["risk"]
        print(f"{risk['id']}  {risk['zone']:<14} {risk['level']:<8} -> {risk['recommended_action']}"
              f"  (expires {risk['expires_at']})")
    print("\nOracle zones live. Now run the AI call triage demo from the Signal Fusion page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
