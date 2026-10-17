import importlib
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError


sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
os.environ["SIGNAL_FUSION_EMBEDDING_PROVIDER"] = "hashing"

engine_module = importlib.import_module("backend.modules.signal-fusion.services.fusion_engine")
store_module = importlib.import_module("backend.modules.signal-fusion.services.store")
schemas_module = importlib.import_module("backend.modules.signal-fusion.models.schemas")
router_module = importlib.import_module("backend.modules.signal-fusion.api.router")


def make_engine(*, seed: bool = False):
    return engine_module.FusionEngine(store=store_module.MemoryFusionStore(), seed=seed)


def report(**overrides):
    payload = {
        "source": "CALL",
        "external_id": None,
        "caller": "test-channel",
        "transcript": "Vehicle collision with a trapped driver",
        "location": "Jalan Test",
        "latitude": 3.15,
        "longitude": 101.71,
        "occurred_at": None,
        "metadata": {},
    }
    return {**payload, **overrides}


def test_duplicate_reports_join_same_cluster():
    engine = make_engine()
    first = engine.ingest_report(report(external_id="CALL-1"))
    second = engine.ingest_report(report(source="SMS", external_id="SMS-1"))

    assert first["cluster"]["id"] == second["cluster"]["id"]
    assert second["signal"]["status"] == "duplicate"
    assert second["decision"]["outcome"] == "duplicate"
    assert second["cluster"]["duplicate_count"] == 1


def test_external_id_is_idempotent():
    engine = make_engine()
    first = engine.ingest_report(report(external_id="CAD-7788"))
    replay = engine.ingest_report(report(external_id="CAD-7788"))

    assert replay["decision"]["outcome"] == "replayed"
    assert replay["signal"]["id"] == first["signal"]["id"]
    assert engine.snapshot()["stats"]["signals_today"] == 1


def test_verified_cluster_promotes_to_stable_incident_handoff():
    engine = make_engine()
    cluster_id = engine.ingest_report(report())["cluster"]["id"]

    with pytest.raises(engine_module.InvalidTransition):
        engine.promote(cluster_id)

    engine.action(cluster_id, "verify", "operator-7")
    promotion = engine.promote(cluster_id, "operator-7")
    replay = engine.promote(cluster_id, "operator-7")

    assert promotion["cluster"]["status"] == "promoted"
    assert promotion["incident"]["state"] == "ready_for_command_center"
    assert promotion["incident"]["source_cluster_id"] == cluster_id
    assert promotion["incident"]["priority"] in {"P1", "P2", "P3", "P4"}
    assert replay["incident"]["id"] == promotion["incident"]["id"]
    assert len(engine.list_incidents()) == 1


def test_promoted_cluster_emits_cursor_events_for_new_evidence():
    engine = make_engine()
    cluster_id = engine.ingest_report(report(external_id="CALL-9"))["cluster"]["id"]
    engine.action(cluster_id, "verify")
    engine.promote(cluster_id)
    engine.ingest_report(report(source="FIELD", external_id="FIELD-10"))

    feed = engine.events(after=0)

    assert [item["event_type"] for item in feed["events"]] == [
        "signal_fusion.incident.promoted.v1",
        "signal_fusion.incident.updated.v1",
    ]
    assert feed["next_cursor"] == 2
    assert engine.events(after=feed["next_cursor"])["events"] == []


def test_operator_brief_contains_actionable_fields():
    engine = make_engine()
    cluster = engine.ingest_report(report())["cluster"]

    assert cluster["key_facts"]
    assert cluster["recommended_actions"]
    assert cluster["priority"]
    assert cluster["version"] == 1


def risk_signal(**overrides):
    payload = {
        "source": "rainfall",
        "external_id": None,
        "zone": "Masjid Jamek",
        "latitude": 3.1492,
        "longitude": 101.6964,
        "observed_at": engine_module.utcnow(),
        "severity": 80,
        "evidence": {"scenario": "demo"},
        "validity_minutes": 45,
    }
    return {**payload, **overrides}


def test_risk_signals_create_forecast_without_creating_an_incident():
    engine = make_engine()
    first = engine.ingest_risk_signal(risk_signal(external_id="RAIN-1"))
    second = engine.ingest_risk_signal(
        risk_signal(source="congestion", external_id="TRAFFIC-1", severity=65)
    )
    acknowledged = engine.acknowledge_risk(second["risk"]["id"], "operator-7")

    assert first["risk"]["level"] == "medium"
    assert second["risk"]["level"] == "high"
    assert second["risk"]["recommended_action"] == "stage_unit"
    assert len(second["risk"]["evidence"]) == 2
    assert engine.list_incidents() == []
    assert acknowledged["acknowledged_by"] == "operator-7"
    assert {item["event_type"] for item in engine.events()["events"]} == {
        "signal_fusion.risk.assessed.v1",
        "signal_fusion.risk.level_changed.v1",
        "signal_fusion.risk.acknowledged.v1",
    }
    assert {item["event_type"] for item in engine.audit()} >= {
        "risk_signal_ingested",
        "risk_level_changed",
        "risk_acknowledged",
    }


def test_risk_signal_replay_and_expiry_are_safe():
    engine = make_engine()
    created = engine.ingest_risk_signal(risk_signal(external_id="RAIN-REPLAY"))
    replay = engine.ingest_risk_signal(risk_signal(external_id="RAIN-REPLAY"))

    assert replay["replayed"] is True
    assert replay["risk_signal"]["id"] == created["risk_signal"]["id"]
    assert engine.list_risks(now=created["risk"]["expires_at"]) == []


def test_risk_signal_timestamp_is_utc_and_bounded_at_the_schema_boundary():
    payload = risk_signal(observed_at=datetime.now(timezone.utc))
    normalized = schemas_module.RiskSignalIn(**payload)

    assert normalized.observed_at.tzinfo == timezone.utc
    with pytest.raises(ValidationError):
        schemas_module.RiskSignalIn(**risk_signal(observed_at=datetime.now()))
    with pytest.raises(ValidationError):
        schemas_module.RiskSignalIn(**risk_signal(observed_at=engine_module.utcnow() + timedelta(minutes=6)))


def test_risk_evidence_uses_each_signal_validity_window():
    engine = make_engine()
    now = engine_module.utcnow()
    engine.ingest_risk_signal(
        risk_signal(external_id="RAIN-LONG", observed_at=now, validity_minutes=60),
        now=now,
    )
    result = engine.ingest_risk_signal(
        risk_signal(
            source="congestion",
            external_id="TRAFFIC-SHORT",
            severity=65,
            observed_at=now + timedelta(minutes=50),
            validity_minutes=30,
        ),
        now=now + timedelta(minutes=50),
    )

    assert result["risk"]["level"] == "high"
    assert {item["external_id"] for item in result["risk"]["evidence"]} == {
        "RAIN-LONG",
        "TRAFFIC-SHORT",
    }


def test_risk_acknowledgement_is_idempotent_and_audited_once():
    engine = make_engine()
    risk_id = engine.ingest_risk_signal(risk_signal(external_id="ACK-ONCE"))["risk"]["id"]
    first = engine.acknowledge_risk(risk_id, "operator-7")
    second = engine.acknowledge_risk(risk_id, "operator-8")

    assert first["acknowledged_by"] == second["acknowledged_by"] == "operator-7"
    assert len([item for item in engine.audit() if item["event_type"] == "risk_acknowledged"]) == 1
    assert len(
        [item for item in engine.events()["events"] if item["event_type"] == "signal_fusion.risk.acknowledged.v1"]
    ) == 1


def test_risk_acknowledgement_rejects_blank_or_oversized_operator_ids():
    for value in ("   ", "x" * 121):
        with pytest.raises(router_module.HTTPException) as error:
            router_module.operator_id(value)
        assert error.value.status_code == 422


def test_risk_refresh_removes_expired_evidence_and_emits_level_change():
    engine = make_engine()
    now = engine_module.utcnow()
    first = engine.ingest_risk_signal(
        risk_signal(
            external_id="RAIN-EXPIRING",
            observed_at=now,
            validity_minutes=60,
        ),
        now=now,
    )
    result = engine.ingest_risk_signal(
        risk_signal(
            source="congestion",
            external_id="TRAFFIC-ACTIVE",
            severity=65,
            observed_at=now + timedelta(minutes=1),
            validity_minutes=60,
        ),
        now=now + timedelta(minutes=1),
    )
    refreshed = engine.list_risks(now=now + timedelta(minutes=60, seconds=30))

    assert first["risk"]["level"] == "medium"
    assert result["risk"]["level"] == "high"
    assert len(refreshed) == 1
    assert refreshed[0]["level"] == "medium"
    assert refreshed[0]["recommended_action"] == "notify"
    assert [item["external_id"] for item in refreshed[0]["evidence"]] == ["TRAFFIC-ACTIVE"]
    assert schemas_module.RiskAssessment.model_validate(refreshed[0]).evidence[0].external_id == "TRAFFIC-ACTIVE"
    assert any(
        item["event_type"] == "signal_fusion.risk.level_changed.v1"
        and item["aggregate_version"] == refreshed[0]["version"]
        for item in engine.events()["events"]
    )


def test_risk_refresh_ignores_persisted_evidence_timestamp_format(monkeypatch):
    engine = make_engine()
    now = engine_module.utcnow()
    created = engine.ingest_risk_signal(risk_signal(external_id="JSON-EVIDENCE", observed_at=now), now=now)
    risk_id = created["risk"]["id"]
    engine.store.risks[risk_id]["evidence"][0]["observed_at"] = now.isoformat()
    events_before = len(engine.store.events)

    def unexpected_refresh(*_args):
        raise AssertionError("semantically unchanged risk should not be persisted")

    monkeypatch.setattr(engine.store, "save_risk_refresh", unexpected_refresh)
    risks = engine.list_risks(now=now + timedelta(minutes=1))

    assert risks[0]["id"] == risk_id
    assert len(engine.store.events) == events_before


def test_expired_risk_signal_replay_returns_a_safe_conflict():
    engine = make_engine()
    now = engine_module.utcnow()
    payload = risk_signal(external_id="EXPIRED-REPLAY", observed_at=now, validity_minutes=30)
    created = engine.ingest_risk_signal(payload, now=now)

    with pytest.raises(engine_module.RiskExpired, match="cannot be replayed"):
        engine.ingest_risk_signal(payload, now=created["risk"]["expires_at"])


def test_new_risk_requires_thirty_to_sixty_minutes_of_remaining_validity():
    engine = make_engine()
    now = engine_module.utcnow()

    with pytest.raises(engine_module.InvalidRiskValidity, match="30 to 60"):
        engine.ingest_risk_signal(
            risk_signal(observed_at=now - timedelta(minutes=16), validity_minutes=45),
            now=now,
        )


def test_active_zone_rejects_stale_risk_signal_without_persisting_it():
    engine = make_engine()
    now = engine_module.utcnow()
    engine.ingest_risk_signal(risk_signal(external_id="ACTIVE-ZONE", observed_at=now), now=now)

    with pytest.raises(engine_module.InvalidRiskValidity, match="30 to 60"):
        engine.ingest_risk_signal(
            risk_signal(
                source="congestion",
                external_id="STALE-CORROBORATION",
                observed_at=now - timedelta(minutes=16),
                validity_minutes=45,
            ),
            now=now,
        )

    assert len(engine.store.risk_signals) == 1


def test_predictive_seed_collapses_five_signals_into_one_incident_ready_cluster():
    snapshot = make_engine(seed=True).snapshot()
    cluster = next(item for item in snapshot["clusters"] if item["id"] == "CL-ORACLE-001")

    assert cluster["signal_count"] == 5
    assert cluster["duplicate_count"] == 0
    assert cluster["correlated_count"] == 4
    assert cluster["independent_sources"] == 5
    assert cluster["lead_time_minutes"] == 8
    assert cluster["confidence"] == 94
    assert [item["confidence"] for item in cluster["confidence_history"]] == [48, 63, 77, 90, 94]
    assert cluster["action_state"] == "Incident Ready"
    assert len(snapshot["signals"]) == 5


def test_independent_source_increases_confidence_more_than_repeated_source():
    now = engine_module.utcnow()
    diverse = make_engine()
    repeated = make_engine()
    first_diverse = diverse.ingest_report(report(external_id="DIVERSE-1"), now)
    second_diverse = diverse.ingest_report(
        report(source="FIELD", external_id="DIVERSE-2", transcript="Responder confirms trapped driver at collision"),
        now + timedelta(minutes=1),
    )
    first_repeated = repeated.ingest_report(report(external_id="REPEAT-1"), now)
    second_repeated = repeated.ingest_report(
        report(external_id="REPEAT-2"),
        now + timedelta(minutes=1),
    )

    assert first_diverse["cluster"]["confidence"] == first_repeated["cluster"]["confidence"]
    assert second_diverse["cluster"]["confidence"] > second_repeated["cluster"]["confidence"]


def test_weather_and_traffic_are_correlated_evidence_not_duplicates():
    engine = make_engine()
    now = engine_module.utcnow()
    rain = engine.ingest_report(
        report(
            source="WEATHER",
            external_id="WEATHER-1",
            transcript="Severe rainfall and drainage near capacity",
            severity=84,
            source_confidence=0.78,
            evidence_role="early_warning",
        ),
        now,
    )
    traffic = engine.ingest_report(
        report(
            source="TRAFFIC",
            external_id="TRAFFIC-1",
            transcript="Road speed dropped sharply during flooding",
            severity=76,
            source_confidence=0.72,
            evidence_role="early_warning",
        ),
        now + timedelta(minutes=2),
    )

    assert rain["cluster"]["id"] == traffic["cluster"]["id"]
    assert traffic["signal"]["status"] == "correlated"
    assert traffic["decision"]["outcome"] == "correlated"
    assert traffic["cluster"]["duplicate_count"] == 0


def test_p1_call_links_existing_risk_zone_and_makes_cluster_incident_ready():
    engine = make_engine()
    now = engine_module.utcnow()
    engine.ingest_report(
        report(
            source="WEATHER",
            external_id="ORACLE-WEATHER",
            transcript="Heavy rain and local drains at capacity",
            severity=84,
            source_confidence=0.78,
            evidence_role="early_warning",
        ),
        now,
    )
    engine.ingest_report(
        report(
            source="TRAFFIC",
            external_id="ORACLE-TRAFFIC",
            transcript="Traffic speed dropped 58 percent on flooded road",
            severity=76,
            source_confidence=0.72,
            evidence_role="early_warning",
        ),
        now + timedelta(minutes=2),
    )
    call = engine.ingest_report(
        report(
            external_id="ORACLE-CALL",
            transcript="999 caller reports rider unconscious after collision in heavy rain",
            severity=96,
            source_confidence=0.93,
            evidence_role="primary_report",
        ),
        now + timedelta(minutes=8),
    )
    risks = engine.list_risks(now=now + timedelta(minutes=8))

    assert call["cluster"]["status"] == "verified"
    assert call["cluster"]["lead_time_minutes"] == 8
    assert call["cluster"]["action_state"] == "Incident Ready"
    assert risks[0]["status"] == "incident_linked"
    assert risks[0]["linked_cluster_id"] == call["cluster"]["id"]
    assert engine.list_incidents() == []


def test_operator_can_override_and_split_without_losing_raw_evidence():
    engine = make_engine(seed=True)
    overridden = engine.override_recommendation(
        "CL-ORACLE-001",
        "Hold ambulance at northern access point",
        "Standing water blocks the southern approach",
        "operator-7",
    )
    split = engine.split(
        "CL-ORACLE-001",
        ["RSK-RAIN-001"],
        "Weather evidence requires regional review",
        "operator-7",
    )

    assert overridden["recommended_action"] == "Hold ambulance at northern access point"
    assert split["source"]["signal_count"] == 4
    assert split["created"]["signal_count"] == 1
    assert len(engine.snapshot()["signals"]) == 5
    assert {item["event_type"] for item in engine.audit()} >= {
        "cluster_override",
        "cluster_split",
    }
