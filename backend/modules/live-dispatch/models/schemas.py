from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Coordinate = tuple[float, float]


class RouteRequest(BaseModel):
    coordinates: list[Coordinate] = Field(min_length=2, max_length=12)
    profile: Literal["driving"] = "driving"
    alternatives: bool = False


class RouteResult(BaseModel):
    coordinates: list[Coordinate]
    distance_km: float
    duration_minutes: float
    provider: str = "local-osrm"


class SeedRoute(RouteResult):
    id: str
    unit_id: str
    incident_id: str
    hospital_id: str
    color: str
    leg: Literal["to_scene", "to_hospital"] = "to_scene"


class MapLocation(BaseModel):
    id: str
    name: str
    kind: Literal["hospital", "ambulance_base", "incident"]
    coordinate: Coordinate
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)


class DispatchSnapshot(BaseModel):
    routing_online: bool
    routing_provider: str
    dataset: str
    locations: list[MapLocation]
    routes: list[SeedRoute]
    failed_route_ids: list[str]
    generated_at: datetime | None = None
    command_center_online: bool = False
    units: list["DispatchUnit"] = Field(default_factory=list)
    facilities: list["Facility"] = Field(default_factory=list)
    incidents: list["DispatchIncident"] = Field(default_factory=list)
    recommendations: list["DispatchRecommendation"] = Field(default_factory=list)
    stats: "DispatchStats | None" = None


UnitStatus = Literal["available", "reserved", "dispatched", "en_route", "on_scene", "transporting", "at_hospital", "offline"]
DispatchStatus = Literal["recommended", "accepted", "rejected", "en_route", "on_scene", "transporting", "completed", "cancelled"]


class Facility(BaseModel):
    id: str
    name: str
    facility_type: Literal["hospital", "ambulance_base"]
    latitude: float
    longitude: float
    capabilities: list[str]
    accepting_patients: bool
    ed_load_percent: int
    ambulance_bays: int
    updated_at: datetime


class CrewMember(BaseModel):
    name: str
    role: str


class DispatchUnit(BaseModel):
    id: str
    callsign: str
    agency: str
    base_facility_id: str | None = None
    status: UnitStatus
    equipment_type: str
    capabilities: list[str]
    crew: list[CrewMember]
    latitude: float
    longitude: float
    heading: int
    speed_kph: float
    fuel_percent: int
    active_incident_id: str | None = None
    location_updated_at: datetime
    version: int
    updated_at: datetime


class DispatchIncident(BaseModel):
    id: str
    command_version: int
    title: str
    summary: str
    category: str
    priority: Literal["P1", "P2", "P3", "P4"]
    severity: int
    status: str
    location: str
    latitude: float
    longitude: float
    sla_status: str
    sla_seconds_remaining: int
    assigned_unit_id: str | None = None
    receiving_hospital_id: str | None = None
    risk_flags: list[str] = Field(default_factory=list)


class CandidateScore(BaseModel):
    unit_id: str
    eligible: bool
    score: float
    eta_minutes: float | None = None
    distance_km: float | None = None
    capability_score: float
    readiness_score: float
    agency_score: float
    workload_score: float
    missing_capabilities: list[str] = Field(default_factory=list)
    reason: str


class DispatchRecommendation(BaseModel):
    id: str
    incident_id: str
    incident_version: int
    priority: str
    severity: int
    category: str
    status: DispatchStatus
    is_backup: bool = False
    unit_id: str
    receiving_facility_id: str | None = None
    optimization_score: float
    score_breakdown: dict[str, float]
    alternatives: list[CandidateScore]
    origin_coordinate: Coordinate
    scene_coordinate: Coordinate
    destination_coordinate: Coordinate | None = None
    route_to_scene: list[Coordinate]
    route_to_hospital: list[Coordinate] | None = None
    scene_distance_km: float
    scene_eta_minutes: float
    hospital_distance_km: float | None = None
    hospital_eta_minutes: float | None = None
    algorithm_version: str
    decision_reason: str
    operator_id: str | None = None
    operator_note: str | None = None
    rejection_reason: str | None = None
    recommended_at: datetime
    accepted_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime
    version: int


class DispatchStats(BaseModel):
    active_incidents: int
    available_units: int
    recommended: int
    active_dispatches: int
    average_recommended_eta: float | None = None
    p1_uncovered: int


class DecisionRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)


class RejectRequest(DecisionRequest):
    reason: str = Field(min_length=4, max_length=1000)
    reoptimize: bool = True


class ReassignRequest(DecisionRequest):
    unit_id: str = Field(min_length=2, max_length=40)
    reason: str = Field(min_length=4, max_length=1000)


class BackupRequest(DecisionRequest):
    capability: str | None = Field(default=None, max_length=40)
    reason: str = Field(min_length=4, max_length=1000)


class DispatchTransitionRequest(DecisionRequest):
    status: Literal["en_route", "on_scene", "transporting", "completed"]


class UnitLocationUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    heading: int = Field(default=0, ge=0, le=359)
    speed_kph: float = Field(default=0, ge=0, le=200)
    expected_version: int | None = Field(default=None, ge=1)
    recalculate_route: bool = True


class FacilityUpdate(BaseModel):
    accepting_patients: bool | None = None
    ed_load_percent: int | None = Field(default=None, ge=0, le=100)
    ambulance_bays: int | None = Field(default=None, ge=0, le=100)


class CareOption(BaseModel):
    facility: Facility
    eligible: bool
    required_capabilities: list[str]
    capability_match: bool
    distance_km: float | None = None
    eta_minutes: float | None = None
    score: float
    reason: str


class CareOptionsResponse(BaseModel):
    incident_id: str
    dispatch_id: str
    dispatch_version: int
    required_capabilities: list[str]
    current_plan: CareOption | None = None
    options: list[CareOption]


class RerouteRequest(BaseModel):
    facility_id: str = Field(min_length=2, max_length=40)
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=4, max_length=1000)
    disruption_evidence: str | None = Field(default=None, max_length=1000)
    override_ineligible: bool = False


class RerouteResponse(BaseModel):
    dispatch: DispatchRecommendation
    previous_facility_id: str | None = None
    reason: str


class PreAlertDraftResponse(BaseModel):
    draft_id: str
    dispatch_id: str
    incident_id: str
    facility_id: str
    required_capabilities: list[str]
    eta_minutes: float | None = None
    message: str
    delivery_status: Literal["draft_only"] = "draft_only"


class DispatchEvent(BaseModel):
    id: int
    event_type: str
    aggregate_id: str
    aggregate_version: int
    payload: dict[str, object]
    created_at: datetime


class DispatchEventFeed(BaseModel):
    events: list[DispatchEvent]
    next_cursor: int
