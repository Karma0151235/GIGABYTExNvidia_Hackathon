from __future__ import annotations

import sys
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
service_module = import_module("backend.modules.dispatch-assistant.services.assistant_service")
store_module = import_module("backend.modules.dispatch-assistant.services.store")


class Context:
    def snapshot(self):
        now = datetime.now(timezone.utc)
        return {
            "limitations": [],
            "risks": [],
            "incidents": [{"id": "INC-1", "title": "Collision", "priority": "P1", "assigned_unit_id": None, "category": "trauma", "recommended_actions": ["Confirm scene details"], "updated_at": now}],
            "units": [{"id": "AMB-07", "status": "available", "capabilities": ["ALS", "TRAUMA", "RESCUE"]}],
            "facilities": [{"id": "hkl", "name": "Hospital KL", "facility_type": "hospital", "accepting_patients": True, "ed_load_percent": 82, "capabilities": ["TRAUMA"]}],
            "dispatches": [{"id": "DSP-1", "incident_id": "INC-1", "unit_id": "AMB-07", "status": "recommended", "decision_reason": "AMB-07 ranked first.", "scene_eta_minutes": 4.2, "receiving_facility_id": "hkl", "alternatives": [{"unit_id": "AMB-07", "eligible": True, "eta_minutes": 4.2}]}],
        }


def make_service():
    return service_module.DispatchAssistantService(store=store_module.MemoryAssistantStore(), context=Context())


def test_why_unit_is_grounded_and_audited():
    service = make_service()
    result = service.query("Why was AMB-07 recommended?", incident_id="INC-1", session_id="S-1")
    assert result["intent"] == "why_unit"
    assert "AMB-07 ranked first" in result["answer"]
    assert result["sources"] == ["live-dispatch:dispatches/DSP-1", "command-center:incidents/INC-1"]
    assert len(service.session("S-1")) == 1


def test_unassigned_critical_and_unsupported_questions_are_safe():
    service = make_service()
    critical = service.query("Which critical incidents are unassigned?", session_id="S-2")
    unsupported = service.query("What medicine should we administer?", session_id="S-2")
    assert "INC-1" in critical["answer"]
    assert unsupported["intent"] == "unsupported"
    assert "only explain" in unsupported["answer"]


def test_hospital_query_uses_current_acceptance_data_only():
    result = make_service().query("Which hospital has capacity for this trauma case?", incident_id="INC-1")
    assert result["intent"] == "hospital"
    assert "Hospital KL" in result["answer"]
    assert "hkl" in " ".join(result["sources"])


def test_copilot_uses_fixed_query_and_returns_visual_ranking(monkeypatch):
    monkeypatch.setattr(service_module.copilot_service, "_openrouter_client", lambda: None)

    result = make_service().copilot(
        "Rank ambulances for INC-1 and explain the recommendation.",
        incident_id="INC-1",
        session_id="S-VISUAL",
    )

    assert result["provider"] == "deterministic"
    assert result["query"]["id"] == "unit_ranking"
    assert result["query"]["mode"] == "static_read_model"
    assert result["recommended_unit_id"] == "AMB-07"
    assert {artifact["type"] for artifact in result["artifacts"]} == {"recommendation", "table"}
    ranking = next(artifact for artifact in result["artifacts"] if artifact["type"] == "table")
    assert ranking["rows"][0]["unit"] == "AMB-07"
    assert ranking["rows"][0]["eta_minutes"] == 4.2


def test_copilot_route_table_is_grounded_in_saved_osrm_decision(monkeypatch):
    monkeypatch.setattr(service_module.copilot_service, "_openrouter_client", lambda: None)

    result = make_service().copilot("Show the route ETA for INC-1.", incident_id="INC-1")

    assert result["query"]["id"] == "route_status"
    rows = result["artifacts"][0]["rows"]
    assert rows == [{
        "incident": "INC-1",
        "unit": "AMB-07",
        "state": "Recommended",
        "scene_eta": 4.2,
        "scene_distance": 0.0,
        "hospital_eta": None,
        "destination": "hkl",
    }]


def test_short_follow_up_reuses_previous_fixed_view(monkeypatch):
    monkeypatch.setattr(service_module.copilot_service, "_openrouter_client", lambda: None)
    service = make_service()
    service.copilot("Rank ambulances for INC-1.", incident_id="INC-1", session_id="S-FOLLOW")

    follow_up = service.copilot("Why that one?", incident_id="INC-1", session_id="S-FOLLOW")

    assert follow_up["query"]["id"] == "unit_ranking"
    assert follow_up["recommended_unit_id"] == "AMB-07"


def test_oracle_view_retains_incident_linked_predictive_history():
    context = Context().snapshot()
    context["fusion"] = {"clusters": [{
        "id": "CL-ORACLE-001", "title": "Flood collision", "location": "Bukit Bintang",
        "risk_zone_id": "RSK-1001", "severity": 96, "confidence": 94,
        "confidence_trend": "rising", "signal_count": 5, "lead_time_minutes": 8,
        "recommended_action": "Stage ambulance", "action_state": "Incident Ready",
        "source_mix": {"WEATHER": 1, "TRAFFIC": 1, "CALL": 1},
    }]}

    result = service_module.query_catalog.execute("Summarize Oracle risks.", context)

    row = result["artifacts"][0]["rows"][0]
    assert row["confidence"] == 94
    assert row["lead_time"] == 8
    assert row["linked_incident"] == "Incident Ready"


def test_greeting_and_irrelevant_prompt_do_not_repeat_overview(monkeypatch):
    monkeypatch.setattr(service_module.copilot_service, "_openrouter_client", lambda: None)
    service = make_service()

    greeting = service.copilot("Hello, what can you do?", session_id="S-HELLO")
    irrelevant = service.copilot("Write me a recipe for chocolate cake.", session_id="S-OFFTOPIC")

    assert greeting["query"]["id"] == "capability_help"
    assert greeting["artifacts"][0]["type"] == "metrics"
    assert irrelevant["query"]["id"] == "unsupported"
    assert irrelevant["artifacts"] == []
