from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


Priority = Literal["P1", "P2", "P3", "P4"]
IncidentStatus = Literal[
    "new",
    "acknowledged",
    "assigned",
    "en_route",
    "on_scene",
    "transporting",
    "resolved",
    "cancelled",
]
SlaStatus = Literal["on_target", "at_risk", "breached", "met"]


class Incident(BaseModel):
    id: str
    source_cluster_id: str
    source_version: int
    command_version: int
    title: str
    summary: str
    category: str
    priority: Priority
    original_priority: Priority
    severity: int = Field(ge=0, le=100)
    confidence: int = Field(ge=0, le=100)
    status: IncidentStatus
    location: str
    latitude: float
    longitude: float
    first_reported_at: datetime
    last_reported_at: datetime
    signal_count: int
    duplicate_count: int
    source_mix: dict[str, int]
    source_signal_ids: list[str]
    key_facts: list[str]
    risk_flags: list[str]
    recommended_actions: list[str]
    assigned_unit_id: str | None = None
    receiving_hospital_id: str | None = None
    owning_agency: str | None = None
    priority_override_reason: str | None = None
    sla_deadline: datetime
    sla_status: SlaStatus
    sla_seconds_remaining: int
    acknowledged_at: datetime | None = None
    assigned_at: datetime | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class DashboardStats(BaseModel):
    active_incidents: int
    unacknowledged: int
    critical_incidents: int
    assigned_incidents: int
    unassigned_incidents: int
    breached_sla: int
    at_risk_sla: int
    target_met_percent: float
    average_acknowledgement_minutes: float | None = None


class Snapshot(BaseModel):
    generated_at: datetime
    source_cursor: int
    source_online: bool
    stats: DashboardStats
    incidents: list[Incident]


class Assignment(BaseModel):
    id: int
    incident_id: str
    unit_id: str
    receiving_hospital_id: str | None = None
    status: Literal["active", "superseded", "released"]
    assigned_by: str
    rationale: str | None = None
    assigned_at: datetime
    ended_at: datetime | None = None


class AuditEvent(BaseModel):
    id: int
    incident_id: str | None = None
    event_type: str
    actor: str
    from_state: str | None = None
    to_state: str | None = None
    payload: dict[str, object]
    created_at: datetime


class CommandEvent(BaseModel):
    id: int
    event_type: str
    aggregate_id: str
    aggregate_version: int
    payload: dict[str, object]
    created_at: datetime


class EventFeed(BaseModel):
    events: list[CommandEvent]
    next_cursor: int


class SyncResult(BaseModel):
    consumed: int
    created: int
    updated: int
    ignored: int
    cursor: int
    source_online: bool


class TransitionRequest(BaseModel):
    status: IncidentStatus
    note: str | None = Field(default=None, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)


class AssignmentRequest(BaseModel):
    unit_id: str = Field(min_length=2, max_length=40)
    receiving_hospital_id: str | None = Field(default=None, max_length=40)
    owning_agency: str | None = Field(default=None, max_length=100)
    rationale: str | None = Field(default=None, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)


class PriorityRequest(BaseModel):
    priority: Priority
    reason: str = Field(min_length=4, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)


class AcknowledgeRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    expected_version: int | None = Field(default=None, ge=1)
