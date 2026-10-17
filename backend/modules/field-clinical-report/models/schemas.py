from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ResponderImage(BaseModel):
    image_id: str = Field(min_length=1, max_length=80)
    kind: Literal["injury", "incident_site", "other"]
    media_type: Literal["image/jpeg", "image/png", "image/webp"]
    data_base64: str = Field(min_length=16, max_length=7_000_000)
    caption: str | None = Field(default=None, max_length=300)


class IncidentGeolocation(BaseModel):
    locality: str | None = Field(default=None, max_length=250)
    address: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_location(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        if not (self.locality or self.address) and self.latitude is None:
            raise ValueError("provide a locality, address, or coordinates")
        return self


class ReportRequest(BaseModel):
    call_id: str = Field(min_length=1, max_length=80)
    incident_id: str = Field(min_length=1, max_length=80)
    dispatch_id: str = Field(min_length=1, max_length=80)
    incident_summary: str = Field(min_length=5, max_length=3000)
    geolocation: IncidentGeolocation
    call_audio_reference: str | None = Field(default=None, max_length=200)
    call_transcript: str | None = Field(default=None, max_length=4000)
    responder_notes: str | None = Field(default=None, max_length=3000)
    receiving_facility_id: str | None = Field(default=None, max_length=80)
    receiving_facility_name: str | None = Field(default=None, max_length=200)
    hospital_eta_minutes: float | None = Field(default=None, ge=0, le=1440)
    images: list[ResponderImage] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def unique_image_ids(self):
        ids = [image.image_id for image in self.images]
        if len(ids) != len(set(ids)):
            raise ValueError("image_id values must be unique")
        return self


class ImageEvidence(BaseModel):
    image_id: str
    kind: str
    media_type: str
    sha256: str


class ImageTriageNote(BaseModel):
    image_id: str
    kind: str
    note: str = Field(min_length=30)


class DraftReport(BaseModel):
    report_id: str
    status: Literal["draft_review_required"] = "draft_review_required"
    call_id: str
    incident_id: str
    dispatch_id: str
    receiving_facility_id: str | None
    receiving_facility_name: str | None
    hospital_eta_minutes: float | None
    incident_summary: str
    geolocation: IncidentGeolocation
    call_audio_reference: str | None
    call_transcript: str | None
    responder_notes: str | None
    image_evidence: list[ImageEvidence]
    image_notes: list[ImageTriageNote]
    model: str
    generated_at: datetime
    limitations: list[str]
