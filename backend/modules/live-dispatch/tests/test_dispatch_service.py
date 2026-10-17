from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
service_module = import_module("backend.modules.live-dispatch.services.dispatch_service")
store_module = import_module("backend.modules.live-dispatch.services.dispatch_store")
LiveDispatchService = service_module.LiveDispatchService
MemoryDispatchStore = store_module.MemoryDispatchStore
NoEligibleUnit = service_module.NoEligibleUnit


def unit(identifier, longitude, capabilities, status="available", agency="MOH"):
    now = datetime.now(timezone.utc)
    return {
        "id": identifier, "callsign": identifier, "agency": agency, "base_facility_id": "hkl",
        "status": status, "equipment_type": "ALS" if "ALS" in capabilities else "BLS",
        "capabilities": capabilities, "crew": [{"name": "Test Crew", "role": "Paramedic"}],
        "latitude": 3.15, "longitude": longitude, "heading": 0, "speed_kph": 0,
        "fuel_percent": 90, "active_incident_id": None, "location_updated_at": now,
        "version": 1, "updated_at": now,
    }


def facility(identifier="hkl", *, longitude=101.70, latitude=3.17, capabilities=None, accepting=True, load=60, bays=4):
    now = datetime.now(timezone.utc)
    return {"id":identifier,"name":identifier,"facility_type":"hospital","latitude":latitude,"longitude":longitude,"capabilities":capabilities or ["TRAUMA","ICU","CARDIAC"],"accepting_patients":accepting,"ed_load_percent":load,"ambulance_bays":bays,"updated_at":now}


def incident(identifier="INC-1", priority="P1", category="Road accident", severity=90):
    return {"id":identifier,"command_version":1,"title":"Emergency","summary":"Emergency response","category":category,"priority":priority,"severity":severity,"status":"acknowledged","location":"KL","latitude":3.16,"longitude":101.72,"sla_status":"at_risk","sla_seconds_remaining":120,"assigned_unit_id":None,"receiving_hospital_id":None,"owning_agency":"MOH","risk_flags":[]}


class FakeRouter:
    async def health(self): return True
    async def route(self, coordinates):
        origin, destination = coordinates[0], coordinates[-1]
        distance = abs(destination[0] - origin[0]) * 100 + abs(destination[1] - origin[1]) * 100
        return {"coordinates":[origin,destination],"distance_km":round(distance,2),"duration_minutes":round(distance*2+1,1),"provider":"test-osrm"}


class FakeCommand:
    def __init__(self, incidents): self.items=incidents;self.actions=[]
    async def incidents(self): return self.items
    async def events(self, after, limit=100): return {"events": [], "next_cursor": after}
    async def acknowledge(self, incident, actor, note=None):
        self.actions.append(("acknowledge",incident["id"]));incident["status"]="acknowledged";incident["command_version"]+=1;return incident
    async def assign(self, incident, unit_id, hospital_id, actor, reason):
        self.actions.append(("assign",incident["id"],unit_id));incident["status"]="assigned";incident["assigned_unit_id"]=unit_id;incident["command_version"]+=1;return incident
    async def transition(self, incident, status, actor, note=None):
        self.actions.append(("transition",incident["id"],status));incident["status"]=status;incident["command_version"]+=1;return incident


def make_service(incidents=None, units=None, facilities=None):
    command=FakeCommand(incidents or [incident()])
    store=MemoryDispatchStore(units or [unit("AMB-ALS",101.70,["ALS","TRAUMA"]),unit("AMB-BLS",101.715,["BLS"]),unit("AMB-RESCUE",101.69,["ALS","TRAUMA","RESCUE"])], facilities or [facility()])
    return LiveDispatchService(store,FakeRouter(),command),command


def test_hard_capability_filter_excludes_closer_ineligible_unit():
    service,_=make_service()
    result=asyncio.run(service.optimize_incident(incident()))
    assert result["unit_id"] in {"AMB-ALS","AMB-RESCUE"}
    bls=next(item for item in result["alternatives"] if item["unit_id"]=="AMB-BLS")
    assert bls["eligible"] is False
    assert "ALS" in bls["missing_capabilities"]


def test_rescue_risk_requires_rescue_capability():
    service,_=make_service()
    trapped=incident();trapped["risk_flags"]=["Occupant trapped; extrication required"]
    result=asyncio.run(service.optimize_incident(trapped))
    assert result["unit_id"]=="AMB-RESCUE"


def test_priority_order_reserves_best_unit_for_p1():
    incidents=[incident("INC-P3","P3",severity=45),incident("INC-P1","P1",severity=90)]
    service,_=make_service(incidents)
    results=asyncio.run(service.optimize_all())
    by_incident={item["incident_id"]:item for item in results}
    assert by_incident["INC-P1"]["unit_id"]=="AMB-ALS"
    assert by_incident["INC-P3"]["unit_id"]!="AMB-ALS"


def test_new_promoted_incident_gets_route_before_acknowledgement():
    promoted=incident();promoted["status"]="new"
    service,_=make_service([promoted])

    results=asyncio.run(service.optimize_all())

    assert results[0]["incident_id"]==promoted["id"]
    assert len(results[0]["route_to_scene"])>=2


def test_accepting_new_incident_acknowledges_before_assignment():
    promoted=incident();promoted["status"]="new"
    service,command=make_service([promoted])
    recommendation=asyncio.run(service.optimize_incident(promoted))

    asyncio.run(service.accept(recommendation["id"],1,"operator"))

    assert command.actions[0]==("acknowledge","INC-1")
    assert command.actions[1][0]=="assign"


def test_accept_and_lifecycle_update_unit_command_center_and_events():
    service,command=make_service()
    recommendation=asyncio.run(service.optimize_incident(incident()))
    accepted=asyncio.run(service.accept(recommendation["id"],1,"operator"))
    en_route=asyncio.run(service.transition(accepted["id"],"en_route",accepted["version"],"operator"))
    assert en_route["status"]=="en_route"
    assert service.store.get_unit(en_route["unit_id"])["status"]=="en_route"
    assert command.actions[0][0]=="assign"
    assert command.actions[1]==("transition","INC-1","en_route")
    assert service.events(0,100)["events"][-1]["event_type"]=="live_dispatch.dispatch.en_route.v1"


def test_location_update_recalculates_active_route():
    service,_=make_service()
    recommendation=asyncio.run(service.optimize_incident(incident()))
    accepted=asyncio.run(service.accept(recommendation["id"],1,"operator"))
    unit_row=service.store.get_unit(accepted["unit_id"])
    result=asyncio.run(service.update_unit_location(accepted["unit_id"],{"latitude":3.155,"longitude":101.71,"heading":90,"speed_kph":40,"expected_version":unit_row["version"],"recalculate_route":True}))
    assert result["dispatch"] is not None
    assert result["dispatch"]["version"]==accepted["version"]+1


def test_optimizer_keeps_accepted_dispatch_when_command_version_advances():
    command_incident=incident()
    service,_=make_service([command_incident])
    recommendation=asyncio.run(service.optimize_incident(command_incident))
    accepted=asyncio.run(service.accept(recommendation["id"],1,"operator"))

    results=asyncio.run(service.optimize_all())

    assert len(results)==1
    assert results[0]["id"]==accepted["id"]
    assert results[0]["status"]=="accepted"


def test_individual_optimizations_do_not_recommend_same_unit_twice():
    service,_=make_service()
    first=asyncio.run(service.optimize_incident(incident("INC-1","P1")))
    second=asyncio.run(service.optimize_incident(incident("INC-2","P1")))

    assert first["unit_id"] != second["unit_id"]


def test_snapshot_exposes_scene_and_hospital_route_legs():
    service,_=make_service()

    snapshot=asyncio.run(service.snapshot())

    assert {route["leg"] for route in snapshot["routes"]}=={"to_scene","to_hospital"}


def test_care_options_exclude_closer_hospital_missing_required_capability():
    facilities = [
        facility("near-cardiac", longitude=101.719, latitude=3.16, capabilities=["CARDIAC", "ICU"], load=20),
        facility("trauma-centre", longitude=101.70, latitude=3.17, capabilities=["TRAUMA", "ICU"], load=60),
        facility("busy-trauma", longitude=101.71, latitude=3.18, capabilities=["TRAUMA", "ICU"], accepting=False),
    ]
    service,_=make_service(facilities=facilities)
    dispatch=asyncio.run(service.optimize_incident(incident()))

    options=asyncio.run(service.care_options(dispatch["incident_id"]))

    assert options["options"][0]["facility"]["id"]=="trauma-centre"
    cardiac=next(item for item in options["options"] if item["facility"]["id"]=="near-cardiac")
    assert cardiac["eligible"] is False
    assert cardiac["capability_match"] is False


def test_reroute_and_pre_alert_are_operator_recorded_and_draft_only():
    facilities = [
        facility("hkl", longitude=101.70, latitude=3.17, capabilities=["TRAUMA", "ICU"], load=60),
        facility("low-load-trauma", longitude=101.7275, latitude=3.0985, capabilities=["TRAUMA", "ICU"], load=10, bays=5),
    ]
    service,_=make_service(facilities=facilities)
    recommended=asyncio.run(service.optimize_incident(incident()))
    accepted=asyncio.run(service.accept(recommended["id"], recommended["version"], "operator"))

    rerouted=asyncio.run(service.reroute(accepted["id"], {"facility_id":"low-load-trauma", "expected_version":accepted["version"], "reason":"ED congestion at current destination", "disruption_evidence":"scenario: ED load increased"}, "operator"))
    draft=asyncio.run(service.pre_alert_draft(rerouted["dispatch"]["id"], "operator"))
    audit=service.audit(rerouted["dispatch"]["id"], 10)

    assert rerouted["dispatch"]["receiving_facility_id"]=="low-load-trauma"
    assert rerouted["previous_facility_id"]=="hkl"
    assert draft["delivery_status"]=="draft_only"
    assert "Incident INC-1" in draft["message"]
    assert {item["event_type"] for item in audit}>={"rerouted", "pre_alert_drafted"}


def test_reroute_allows_an_eligible_facility_outside_the_displayed_top_three():
    facilities = [
        facility("hkl", longitude=101.70, latitude=3.17, capabilities=["TRAUMA", "ICU"], load=10),
        facility("second", longitude=101.71, latitude=3.17, capabilities=["TRAUMA", "ICU"], load=20),
        facility("third", longitude=101.72, latitude=3.17, capabilities=["TRAUMA", "ICU"], load=30),
        facility("rank-four", longitude=101.80, latitude=3.17, capabilities=["TRAUMA", "ICU"], load=90),
    ]
    service,_=make_service(facilities=facilities)
    recommended=asyncio.run(service.optimize_incident(incident()))
    accepted=asyncio.run(service.accept(recommended["id"], recommended["version"], "operator"))

    choices=asyncio.run(service.care_options(accepted["incident_id"]))
    rerouted=asyncio.run(service.reroute(accepted["id"], {"facility_id":"rank-four", "expected_version":accepted["version"], "reason":"Operator selected available specialist capacity"}, "operator"))

    assert "rank-four" not in {item["facility"]["id"] for item in choices["options"]}
    assert rerouted["dispatch"]["receiving_facility_id"]=="rank-four"


def test_repeated_pre_alert_drafts_emit_distinct_events_with_dispatch_ids():
    service,_=make_service()
    recommended=asyncio.run(service.optimize_incident(incident()))
    accepted=asyncio.run(service.accept(recommended["id"], recommended["version"], "operator"))

    first=asyncio.run(service.pre_alert_draft(accepted["id"], "operator"))
    second=asyncio.run(service.pre_alert_draft(accepted["id"], "operator"))
    events=[item for item in service.events(0, 100)["events"] if item["event_type"]=="live_dispatch.care.pre_alert_drafted.v1"]

    assert len(events)==2
    assert {item["aggregate_id"] for item in events}=={first["draft_id"], second["draft_id"]}
    assert {item["payload"]["dispatch_id"] for item in events}=={accepted["id"]}
    assert {item["payload"]["draft_id"] for item in events}=={first["draft_id"], second["draft_id"]}
    assert first["draft_id"] != second["draft_id"]


def test_no_eligible_unit_is_explicit():
    service,_=make_service(units=[unit("AMB-OFF",101.70,["ALS"],status="offline")])
    with pytest.raises(NoEligibleUnit):
        asyncio.run(service.optimize_incident(incident()))
