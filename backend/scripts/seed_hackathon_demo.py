"""Idempotent, current-time simulation data for the ANWAR hackathon demo."""

from __future__ import annotations

import sys
from importlib import import_module
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

command_module = import_module("backend.modules.command-center.services.command_service")
fusion_module = import_module("backend.modules.signal-fusion.services.fusion_engine")
CommandCenterService = command_module.CommandCenterService
FusionEngine = fusion_module.FusionEngine


SCENARIOS = [
    ("CALL", "Multiple casualties after a bus collision; one person is trapped and unconscious.", "Jalan Tun Razak", 3.1578, 101.7214),
    ("FIELD", "Severe chest pain and loss of consciousness reported in the KLCC concourse.", "KLCC Concourse", 3.1571, 101.7116),
    ("APP", "Kitchen gas leak with staff evacuating; no ignition and two people dizzy.", "Bukit Bintang", 3.1466, 101.7108),
    ("RADIO", "Flash flooding has stranded two vehicles near the river crossing; water is rising.", "Masjid Jamek", 3.1492, 101.6964),
    ("CCTV", "Motorcyclist down after a collision outside the university gate; traffic remains moving.", "Universiti Malaya", 3.1201, 101.6535),
]


class LocalFusionFeed:
    def __init__(self, engine: FusionEngine) -> None:
        self.engine = engine

    def events(self, after: int, limit: int = 100) -> dict:
        return self.engine.events(after, limit)


def main() -> None:
    engine = FusionEngine()
    marker = "ANWAR-HACKATHON-2026"

    incident_ids = []
    for index, (source, transcript, location, latitude, longitude) in enumerate(SCENARIOS, start=1):
        external_id = f"{marker}-{index:02d}"
        existing = engine.store.find_signal_by_external_id(external_id)
        if existing:
            incident = engine.store.get_incident_by_cluster(existing["cluster_id"])
            if incident:
                incident_ids.append(incident["id"])
                continue
        result = engine.ingest_report({
            "source": source,
            "external_id": external_id,
            "caller": "ANWAR simulation",
            "transcript": transcript,
            "location": location,
            "latitude": latitude,
            "longitude": longitude,
            "occurred_at": None,
            "metadata": {"demo": True, "scenario": "hackathon"},
        })
        cluster_id = result["cluster"]["id"]
        engine.action(cluster_id, "verify", "hackathon-seed")
        incident_ids.append(engine.promote(cluster_id, "hackathon-seed")["incident"]["id"])

    command = CommandCenterService(source=LocalFusionFeed(engine))
    command.snapshot()

    for index, incident_id in enumerate(incident_ids):
        incident = command.get_incident(incident_id)
        if index == 0 and incident["priority"] != "P1":
            incident = command.override_priority(incident_id, "P1", reason="Multiple casualties reported", actor="hackathon-seed", expected_version=incident["command_version"])
        if index < 4:
            if incident["status"] == "new":
                incident = command.acknowledge(incident_id, actor="hackathon-seed", note="Simulation acknowledgement", expected_version=incident["command_version"])
        if index in {0, 1, 3}:
            if incident["status"] == "acknowledged":
                incident = command.assign(incident_id, {"unit_id": ["AMB-07", "AMB-02", "AMB-05"][{0: 0, 1: 1, 3: 2}[index]], "receiving_hospital_id": "hkl", "rationale": "Simulation assignment", "expected_version": incident["command_version"]}, actor="hackathon-seed")
        if index == 0 and incident["status"] == "assigned":
            command.transition(incident_id, "en_route", actor="hackathon-seed", note="Unit rolling", expected_version=incident["command_version"])

    print(f"Seeded {len(incident_ids)} current simulation incidents.")


if __name__ == "__main__":
    main()
