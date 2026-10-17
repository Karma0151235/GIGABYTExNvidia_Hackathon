from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator


SignalSource = Literal["WEATHER", "TRAFFIC", "CALL", "FIELD", "SMS", "APP", "RADIO", "CCTV"]
SignalStatus = Literal["new", "correlated", "clustered", "duplicate", "dismissed"]
ClusterStatus = Literal["emerging", "verified", "promoted", "dismissed"]
IncidentPriority = Literal["P1", "P2", "P3", "P4"]
RiskSource = Literal["rainfall", "congestion", "weather", "traffic", "cctv", "event", "field"]
RiskLevel = Literal["low", "medium", "high", "critical"]
PreparationAction = Literal["monitor", "notify", "stage_unit", "alert_hospital"]
EvidenceRole = Literal["early_warning", "corroborating", "primary_report", "duplicate_report"]
ConfidenceTrend = Literal["rising", "stable", "decaying"]
ActionState = Literal["Monitor", "Staged", "Awaiting Review", "Incident Ready"]
MetadataValue = str | int | float | bool


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SignalIn(BaseModel):
    source: SignalSource = "CALL"
    external_id: str | None = Field(default=None, min_length=1, max_length=160)
    caller: str = Field(default="Anonymous / unknown", min_length=1, max_length=120)
    transcript: str = Field(min_length=5, max_length=4000)
    location: str = Field(min_length=2, max_length=200)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    observed_at: datetime | None = None
    occurred_at: datetime | None = None
    severity: int | None = Field(default=None, ge=0, le=100)
    source_confidence: float | None = Field(default=None, ge=0, le=1)
    evidence_role: EvidenceRole | None = None
    metadata: dict[str, MetadataValue] = Field(default_factory=dict)


class Signal(SignalIn):
    id: str
    received_at: datetime = Field(default_factory=utcnow)
    severity: int = Field(ge=0, le=100)
    source_confidence: float = Field(ge=0, le=1)
    evidence_role: EvidenceRole
    status: SignalStatus = "new"
    cluster_id: str | None = None


class Cluster(BaseModel):
    id: str
    title: str
    summary: str
    category: str
    location: str
    latitude: float
    longitude: float
    signal_count: int
    duplicate_count: int
    confidence: int
    severity: int
    priority: IncidentPriority
    status: ClusterStatus = "emerging"
    first_seen: datetime
    last_seen: datetime
    source_mix: dict[str, int]
    signal_ids: list[str]
    key_facts: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    incident_id: str | None = None
    version: int = 1
    correlated_count: int = 0
    evidence_count: int = 0
    independent_sources: int = 0
    first_call_at: datetime | None = None
    lead_time_minutes: int | None = None
    sla_started_at: datetime | None = None
    sla_seconds_elapsed: int | None = None
    confidence_trend: ConfidenceTrend = "stable"
    confidence_history: list[dict[str, object]] = Field(default_factory=list)
    action_state: ActionState = "Monitor"
    recommended_action: str = "Continue monitoring and collect corroborating evidence."
    risk_zone_id: str | None = None
    confidence_explanation: str = ""


class FusionDecision(BaseModel):
    outcome: Literal["new_cluster", "correlated", "duplicate", "replayed"]
    reason: str
    cluster_id: str
    cluster_created: bool
    fusion_score: float = Field(ge=0, le=1)
    semantic_score: float = Field(ge=0, le=1)
    distance_km: float | None = None
    provider: str


class IngestionResult(BaseModel):
    signal: Signal
    cluster: Cluster
    decision: FusionDecision
    processing_latency_ms: int


class TriageRequest(BaseModel):
    transcript: str | None = Field(default=None, min_length=5, max_length=4000)
    audio_base64: str | None = Field(default=None, max_length=8_000_000)
    audio_filename: str = "call.webm"
    caller: str = Field(default="999 caller", min_length=1, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class TriageCard(BaseModel):
    location_name: str
    patient_count: int
    condition_summary: str
    priority: Literal["P1", "P2", "P3"]
    rationale: str
    confidence: float = Field(ge=0, le=1)
    caller_language: str
    english_summary: str
    provider: Literal["llm", "heuristic"]
    transcript: str


class AudioEvidence(BaseModel):
    id: str
    filename: str
    content_type: str
    size_bytes: int
    url: str


class TriageResult(BaseModel):
    triage: TriageCard
    ingestion: IngestionResult
    audio: AudioEvidence | None = None


class IncidentHandoff(BaseModel):
    id: str
    source_cluster_id: str
    version: int
    state: Literal["ready_for_command_center"] = "ready_for_command_center"
    title: str
    summary: str
    category: str
    priority: IncidentPriority
    severity: int
    confidence: int
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
    created_at: datetime
    updated_at: datetime


class FusionStats(BaseModel):
    signals_today: int
    active_clusters: int
    duplicates_removed: int
    reduction_rate: float
    average_confidence: float
    processing_latency_ms: int
    incidents_ready: int = 0


class Snapshot(BaseModel):
    generated_at: datetime
    stats: FusionStats
    signals: list[Signal]
    clusters: list[Cluster]
    risks: list[RiskAssessment] = Field(default_factory=list)
    audit_events: list[dict[str, object]] = Field(default_factory=list)


class MergeRequest(BaseModel):
    source_cluster_id: str
    target_cluster_id: str


class AuditEvent(BaseModel):
    id: int
    event_type: str
    entity_type: str
    entity_id: str
    actor: str
    payload: dict[str, object]
    created_at: datetime


class IntegrationEvent(BaseModel):
    id: int
    event_type: str
    aggregate_id: str
    aggregate_version: int
    payload: IncidentHandoff | RiskAssessment
    created_at: datetime


class EventFeed(BaseModel):
    events: list[IntegrationEvent]
    next_cursor: int


class PromotionResult(BaseModel):
    cluster: Cluster
    incident: IncidentHandoff
    event_id: int


class RiskSignalIn(BaseModel):
    source: RiskSource
    external_id: str | None = Field(default=None, min_length=1, max_length=160)
    zone: str = Field(min_length=2, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    observed_at: datetime = Field(default_factory=utcnow)
    severity: int = Field(ge=0, le=100)
    evidence: dict[str, MetadataValue] = Field(default_factory=dict)
    validity_minutes: int = Field(default=45, ge=30, le=60)

    @field_validator("observed_at")
    @classmethod
    def normalize_observed_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observed_at must include a timezone")
        value = value.astimezone(timezone.utc)
        if value > utcnow() + timedelta(minutes=5):
            raise ValueError("observed_at cannot be more than five minutes in the future")
        return value

class RiskSignal(RiskSignalIn):
    id: str
    risk_id: str
    received_at: datetime = Field(default_factory=utcnow)


class RiskAssessment(BaseModel):
    id: str
    zone: str
    latitude: float
    longitude: float
    level: RiskLevel
    confidence: int = Field(ge=0, le=100)
    evidence: list[RiskSignal]
    recommended_action: PreparationAction
    generated_at: datetime
    expires_at: datetime
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    version: int
    radius_km: float = 3.0
    status: Literal["watching", "acknowledged", "incident_linked", "expired"] = "watching"
    confidence_trend: ConfidenceTrend = "stable"
    latest_evidence_at: datetime | None = None
    linked_cluster_id: str | None = None
    summary: str = ""


class RiskIngestionResult(BaseModel):
    risk_signal: RiskSignal
    risk: RiskAssessment
    replayed: bool = False


class SplitRequest(BaseModel):
    signal_ids: list[str] = Field(min_length=1)
    reason: str = Field(min_length=4, max_length=500)


class OverrideRequest(BaseModel):
    recommended_action: str = Field(min_length=4, max_length=500)
    reason: str = Field(min_length=4, max_length=500)
