"""DGX Spark Omni VLM adapter for responder-photo ER handoff drafts."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import uuid
from datetime import datetime, timezone
from importlib import import_module

from pydantic import ValidationError
from PIL import Image, ImageOps, UnidentifiedImageError


schemas = import_module("backend.modules.field-clinical-report.models.schemas")
DEFAULT_BASE_URL = "http://192.168.0.108:9001/v1"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000


class InvalidImage(ValueError):
    pass


class VLMUnavailable(RuntimeError):
    pass


class InvalidVLMResponse(RuntimeError):
    pass


SYSTEM_PROMPT = (
    "You are drafting a pre-arrival emergency department handoff from first-responder photos and supplied incident notes. "
    "Describe only directly visible findings, cite the image_id for every injury finding, and clearly mark uncertainty. "
    "Keep caller/dispatch statements separate from image observations. Do not infer internal injuries, diagnose, estimate blood loss, "
    "assign clinical severity, or recommend treatment from photographs. Never claim that a hospital was notified. "
    "If no patient injury is visible, return an empty injury_findings list. "
    "Return only a JSON object with keys injury_findings, scene_observations, discrepancies, uncertainties, "
    "handoff_summary, hospital_preparation_notes. Each injury finding has image_ids, body_region, observation, certainty "
    "where certainty is visible or uncertain. Hospital preparation notes are items for clinician review, not orders."
)


def health() -> dict:
    return {
        "module": "field-clinical-report",
        "status": "configuration_only",
        "provider": "dgx-spark-vllm",
        "base_url": os.getenv("DGX_VLM_BASE_URL", DEFAULT_BASE_URL),
        "model": os.getenv("DGX_VLM_MODEL", "omni"),
        "image_limit": 4,
        "max_image_bytes": MAX_IMAGE_BYTES,
    }


def _client():
    from openai import OpenAI

    return OpenAI(
        base_url=os.getenv("DGX_VLM_BASE_URL", DEFAULT_BASE_URL),
        api_key="not-used",
        timeout=float(os.getenv("DGX_VLM_TIMEOUT_SECONDS", "90")),
        max_retries=0,
    )


def _decode_image(image) -> tuple[bytes, str]:
    value = image.data_base64
    if value.startswith("data:"):
        prefix, separator, value = value.partition(",")
        if not separator or prefix != f"data:{image.media_type};base64":
            raise InvalidImage(f"{image.image_id}: data URI media type does not match media_type")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise InvalidImage(f"{image.image_id}: invalid base64 image") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise InvalidImage(f"{image.image_id}: image exceeds 5 MB")
    signatures = {
        "image/jpeg": raw.startswith(b"\xff\xd8\xff"),
        "image/png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": raw.startswith(b"RIFF") and raw[8:12] == b"WEBP",
    }
    if not signatures[image.media_type]:
        raise InvalidImage(f"{image.image_id}: image bytes do not match media_type")
    expected_format = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[image.media_type]
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.format != expected_format or source.width * source.height > MAX_IMAGE_PIXELS:
                raise InvalidImage(f"{image.image_id}: unsupported format or image dimensions")
            source.load()
            clean = ImageOps.exif_transpose(source)
            if expected_format == "JPEG" and clean.mode != "RGB":
                clean = clean.convert("RGB")
            output = io.BytesIO()
            save_options = {"quality": 95, "subsampling": 0} if expected_format == "JPEG" else {}
            clean.save(output, format=expected_format, **save_options)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise InvalidImage(f"{image.image_id}: image could not be decoded") from exc
    clean_base64 = base64.b64encode(output.getvalue()).decode("ascii")
    return raw, f"data:{image.media_type};base64,{clean_base64}"


def _parse_analysis(content: str | None, allowed_image_ids: set[str]):
    if not content:
        raise InvalidVLMResponse("VLM returned no final report content")
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        analysis = schemas.VisionAnalysis.model_validate(json.loads(cleaned))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise InvalidVLMResponse("VLM did not return a valid structured draft") from exc
    for finding in analysis.injury_findings:
        if not set(finding.image_ids) <= allowed_image_ids:
            raise InvalidVLMResponse("VLM cited an image_id that was not supplied")
    return analysis


def generate_draft(request, *, client=None) -> dict:
    images = []
    evidence = []
    for image in request.images:
        raw, url = _decode_image(image)
        images.append((image, url))
        evidence.append({
            "image_id": image.image_id, "kind": image.kind,
            "media_type": image.media_type, "sha256": hashlib.sha256(raw).hexdigest(),
        })

    context = {
        "call_id": request.call_id,
        "incident_id": request.incident_id,
        "dispatch_id": request.dispatch_id,
        "incident_summary_from_ingestion": request.incident_summary,
        "geolocation_from_ingestion": request.geolocation.model_dump(),
        "call_transcript_from_ingestion": request.call_transcript,
        "call_audio_reference": request.call_audio_reference,
        "responder_notes": request.responder_notes,
        "receiving_facility": request.receiving_facility_name or request.receiving_facility_id,
        "hospital_eta_minutes": request.hospital_eta_minutes,
        "images": [
            {"image_id": image.image_id, "kind": image.kind, "caption_from_responder": image.caption}
            for image, _ in images
        ],
    }
    content = [{"type": "text", "text": "Create the structured draft from this supplied context and the following images:\n" + json.dumps(context)}]
    for image, url in images:
        content.append({"type": "text", "text": f"Image {image.image_id} ({image.kind})"})
        content.append({"type": "image_url", "image_url": {"url": url}})

    model = os.getenv("DGX_VLM_MODEL", "omni")
    try:
        completion = (client or _client()).chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}],
            max_tokens=int(os.getenv("DGX_VLM_MAX_TOKENS", "4096")),
            temperature=0,
        )
        answer = completion.choices[0].message.content
    except Exception as exc:
        raise VLMUnavailable("DGX Spark Omni VLM request failed; check the endpoint or SSH tunnel") from exc

    analysis = _parse_analysis(answer, {image.image_id for image in request.images})
    return schemas.DraftReport(
        report_id=f"ERD-{uuid.uuid4().hex[:12].upper()}",
        call_id=request.call_id,
        incident_id=request.incident_id,
        dispatch_id=request.dispatch_id,
        receiving_facility_id=request.receiving_facility_id,
        receiving_facility_name=request.receiving_facility_name,
        hospital_eta_minutes=request.hospital_eta_minutes,
        incident_summary=request.incident_summary,
        geolocation=request.geolocation,
        call_audio_reference=request.call_audio_reference,
        call_transcript=request.call_transcript,
        responder_notes=request.responder_notes,
        image_evidence=evidence,
        analysis=analysis,
        model=model,
        generated_at=datetime.now(timezone.utc),
        limitations=[
            "Draft for receiving clinician review; no diagnosis or treatment decision is established from photographs.",
            "Images and supplied notes may omit vital signs, concealed injuries, or changes after capture.",
        ],
    ).model_dump(mode="json")
