from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class AssistantQuery(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    incident_id: str | None = Field(default=None, max_length=64)
    session_id: str | None = Field(default=None, max_length=64)


class ArtifactColumn(BaseModel):
    key: str
    label: str
    format: Literal["text", "number", "minutes", "distance", "percent", "score", "priority", "boolean"] = "text"


class ArtifactMetric(BaseModel):
    label: str
    value: str
    detail: str
    tone: Literal["blue", "cyan", "green", "amber", "red", "slate"] = "slate"


class VisualArtifact(BaseModel):
    id: str
    type: Literal["table", "metrics", "recommendation"]
    title: str
    subtitle: str
    columns: list[ArtifactColumn] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    metrics: list[ArtifactMetric] = Field(default_factory=list)


class QueryExecution(BaseModel):
    id: str
    label: str
    mode: Literal["static_read_model"]
    focus_incident_id: str | None = None
    row_count: int
    executed_at: datetime
    data_sources: list[str]


class AssistantResponse(BaseModel):
    session_id: str
    answer: str
    intent: str
    sources: list[str]
    suggested_actions: list[str]
    generated_at: datetime
    limitations: list[str]


class CopilotResponse(BaseModel):
    session_id: str
    intent: str
    answer: str
    recommended_unit_id: str | None
    recommended_facility_id: str | None
    rationale: str
    confidence: float = Field(ge=0, le=1)
    suggested_actions: list[str]
    sources: list[str]
    limitations: list[str]
    provider: str
    model: str
    query: QueryExecution
    artifacts: list[VisualArtifact]
    generated_at: datetime


class SessionEntry(BaseModel):
    id: int
    incident_id: str | None
    question: str
    answer: str
    intent: str
    sources: list[str]
    suggested_actions: list[str]
    limitations: list[str]
    created_at: datetime


class SopSnippet(BaseModel):
    topic: str
    owner: str
    version: str
    content: str
