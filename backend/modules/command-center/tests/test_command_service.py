from __future__ import annotations

from datetime import datetime, timezone
from importlib import import_module
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))


service_module = import_module("backend.modules.command-center.services.command_service")
store_module = import_module("backend.modules.command-center.services.store")
CommandCenterService = service_module.CommandCenterService
InvalidTransition = service_module.InvalidTransition
ConcurrencyConflict = store_module.ConcurrencyConflict
MemoryCommandCenterStore = store_module.MemoryCommandCenterStore


class FakeSource:
    def __init__(self, events):
        self.items = events

    def events(self, after, limit=100):
        events = [item for item in self.items if item["id"] > after][:limit]
        return {"events": events, "next_cursor": events[-1]["id"] if events else after}


def handoff(version=1, priority="P1", signal_count=2):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": "INC-1001", "source_cluster_id": "CLU-2041", "version": version,
        "state": "ready_for_command_center", "title": "Multi-vehicle collision",
        "summary": "Two vehicles collided with one trapped occupant.",
        "category": "Road accident", "priority": priority, "severity": 91,
        "confidence": 94, "location": "Jalan Tun Razak", "latitude": 3.1578,
        "longitude": 101.7214, "first_reported_at": now, "last_reported_at": now,
        "signal_count": signal_count, "duplicate_count": 1,
        "source_mix": {"CALL": 1, "SMS": 1}, "source_signal_ids": ["SIG-1", "SIG-2"],
        "key_facts": ["Occupant trapped"], "risk_flags": ["Road obstruction"],
        "recommended_actions": ["Dispatch rescue unit"], "created_at": now, "updated_at": now,
    }


def event(event_id=1, version=1, priority="P1", signal_count=2):
    return {
        "id": event_id,
        "event_type": "signal_fusion.incident.promoted.v1" if version == 1 else "signal_fusion.incident.updated.v1",
        "aggregate_id": "INC-1001", "aggregate_version": version,
        "payload": handoff(version, priority, signal_count),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def risk_event(event_id=1):
    return {
        "id": event_id,
        "event_type": "signal_fusion.risk.assessed.v1",
        "aggregate_id": "RSK-1001",
        "aggregate_version": 1,
        "payload": {"id": "RSK-1001", "level": "high"},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def make_service(events=None):
    return CommandCenterService(MemoryCommandCenterStore(), FakeSource(events or [event()]))


def test_sync_is_idempotent_and_advances_cursor():
    service = make_service()
    first = service.sync()
    second = service.sync()
    assert first == {"consumed": 1, "created": 1, "updated": 0, "ignored": 0, "cursor": 1, "source_online": True}
    assert second["consumed"] == 0
    assert service.snapshot(sync=False)["stats"]["active_incidents"] == 1


def test_non_incident_signal_fusion_events_advance_cursor_before_later_incidents():
    store = MemoryCommandCenterStore()
    service = CommandCenterService(store, FakeSource([risk_event(1), event(2)]))

    ignored = service.sync(limit=1)
    assert ignored["ignored"] == 1
    assert ignored["cursor"] == store.get_cursor() == 1

    created = service.sync(limit=1)
    assert created["created"] == 1
    assert created["cursor"] == store.get_cursor() == 2
    assert service.get_incident("INC-1001")["source_version"] == 1


def test_source_update_preserves_operator_priority_override():
    source = FakeSource([event()])
    service = CommandCenterService(MemoryCommandCenterStore(), source)
    service.sync()
    incident = service.acknowledge("INC-1001", actor="op-1", note=None, expected_version=1)
    overridden = service.override_priority(
        "INC-1001", "P2", reason="Clinical callback downgraded acuity",
        actor="supervisor", expected_version=incident["command_version"],
    )
    source.items.append(event(2, 2, "P1", 3))
    result = service.sync()
    current = service.get_incident("INC-1001")
    assert result["updated"] == 1
    assert current["priority"] == "P2"
    assert current["original_priority"] == "P1"
    assert current["signal_count"] == 3
    assert current["priority_override_reason"] == "Clinical callback downgraded acuity"
    assert current["command_version"] == overridden["command_version"]


def test_lifecycle_assignment_and_audit_history():
    service = make_service()
    service.sync()
    acknowledged = service.acknowledge("INC-1001", actor="op-1", note="Taking control", expected_version=1)
    assigned = service.assign(
        "INC-1001",
        {"unit_id": "AMB-01", "receiving_hospital_id": "hkl", "owning_agency": "MERS999",
         "rationale": "Nearest ALS unit", "expected_version": acknowledged["command_version"]},
        actor="dispatcher-1",
    )
    en_route = service.transition(
        "INC-1001", "en_route", actor="dispatcher-1", note=None,
        expected_version=assigned["command_version"],
    )
    assert en_route["assigned_unit_id"] == "AMB-01"
    assert en_route["status"] == "en_route"
    assert service.assignments("INC-1001")[0]["status"] == "active"
    assert {item["event_type"] for item in service.audit("INC-1001", 20)} >= {
        "incident_ingested", "acknowledged", "assigned", "status_en_route"
    }


def test_invalid_transition_and_stale_version_are_rejected():
    service = make_service()
    service.sync()
    with pytest.raises(InvalidTransition):
        service.transition("INC-1001", "on_scene", actor="op-1", note=None, expected_version=1)
    service.acknowledge("INC-1001", actor="op-1", note=None, expected_version=1)
    with pytest.raises(ConcurrencyConflict):
        service.override_priority("INC-1001", "P2", reason="Validated downgrade", actor="op-2", expected_version=1)


def test_snapshot_statistics_are_derived_from_operational_state():
    service = make_service()
    service.sync()
    snapshot = service.snapshot(sync=False)
    assert snapshot["stats"]["active_incidents"] == 1
    assert snapshot["stats"]["critical_incidents"] == 1
    assert snapshot["stats"]["unacknowledged"] == 1
    assert snapshot["stats"]["unassigned_incidents"] == 1
    assert snapshot["incidents"][0]["sla_status"] in {"on_target", "at_risk"}
