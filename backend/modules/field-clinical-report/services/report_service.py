"""DGX Spark Omni VLM adapter for responder-photo ER handoff drafts."""
from __future__ import annotations

import base64
import hashlib
import io
import os
import uuid
from datetime import datetime, timezone
from importlib import import_module

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


SYSTEM_PROMPT = """
You are a clinical image-triage assistant. You write a short handoff note for ER staff and first responders from a single image. This is a TEST of an image-analysis pipeline.

Output ONLY the note in exactly the layout below. No markdown, no code fences, no text before or after it. Keep every line under 70 characters.

LAYOUT:

ER TRIAGE NOTE (TEST OUTPUT ONLY)
======================================================================
TRIAGE: <CRITICAL | URGENT | LESS URGENT | CANNOT DETERMINE>
<one-line visual reason, 12 words or fewer>
----------------------------------------------------------------------
INJURIES
1. <Region, side> | <injury type> | BLEEDING: <ACTIVE | CONTROLLED | NONE VISIBLE | CANNOT ASSESS> | CONF: <high | medium | low>
   size: <only if a clear scale is visible; otherwise omit this line>
2. ... (one numbered entry per injury, most serious first)
(write "None visible" if there are no injuries)
----------------------------------------------------------------------
BLEEDING
Overall: <NONE VISIBLE | MINOR | MODERATE | MAJOR | CANNOT ASSESS>
Control visible: <pressure, dressing, tourniquet, or none>
----------------------------------------------------------------------
PATIENT (VISIBLE ONLY)
Position: <short phrase>
Responsiveness: <cannot assess | appears responsive | appears unresponsive>
Breathing: <cannot assess | visible labored | visible normal | no visible movement>
----------------------------------------------------------------------
OTHER FINDINGS
- <deformity, swelling, exposed bone or tissue, foreign object, burn, wound contamination>
(write "None visible" if there are none)
----------------------------------------------------------------------
HAZARDS AFFECTING CARE
- <only hazards that affect treatment or transport, such as traffic, fire, entrapment>
(write "None visible" if there are none)
----------------------------------------------------------------------
NOT ASSESSABLE FROM IMAGE
<comma-separated list, e.g. airway, vital signs, mechanism, time since injury>
----------------------------------------------------------------------
Image check: <appears real | appears simulated | uncertain>
Not a medical or legal assessment.

RULES:
- Describe only what is visible. Use plain clinical wording; no dramatic language.
- Never identify anyone. Never infer cause, intent or blame.
- A single image cannot reliably show breathing or responsiveness. Write "cannot assess" for both unless it is unmistakable.
- Do not judge arterial versus venous bleeding. Do not estimate blood volume.
- Do not describe the scene, vehicles or surroundings unless they affect care. Do not repeat the same finding in two sections.
- Use only the allowed values shown in the layout.
""".strip()


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


def _validate_note(content: str | None) -> str:
    if not content:
        raise InvalidVLMResponse("VLM returned no final report content")
    note = content.strip()
    required_lines = (
        "ER TRIAGE NOTE (TEST OUTPUT ONLY)", "INJURIES", "BLEEDING",
        "PATIENT (VISIBLE ONLY)", "OTHER FINDINGS", "HAZARDS AFFECTING CARE",
        "NOT ASSESSABLE FROM IMAGE", "Not a medical or legal assessment.",
    )
    lines = note.splitlines()
    if (not lines or lines[0] != required_lines[0]
            or lines[-1] != required_lines[-1]
            or any(line not in lines for line in required_lines)
            or not any(line.startswith("TRIAGE: ") for line in lines)
            or not any(line.startswith("Image check: ") for line in lines)
            or any(len(line) > 70 for line in lines)
            or "```" in note):
        raise InvalidVLMResponse("VLM did not follow the ER triage note layout")
    return note


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

    model = os.getenv("DGX_VLM_MODEL", "omni")
    try:
        vlm = client or _client()
    except Exception as exc:
        raise VLMUnavailable("DGX Spark Omni VLM request failed; check the endpoint or SSH tunnel") from exc
    notes = []
    for image, url in images:
        content = [
            {"type": "text", "text": "Analyze this single image using the exact ER triage note layout. "
             "The supplied call and dispatch details are not visual evidence."},
            {"type": "image_url", "image_url": {"url": url}},
        ]
        try:
            completion = vlm.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}],
                max_tokens=int(os.getenv("DGX_VLM_MAX_TOKENS", "4096")),
                temperature=0,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
            answer = completion.choices[0].message.content
        except Exception as exc:
            raise VLMUnavailable("DGX Spark Omni VLM request failed; check the endpoint or SSH tunnel") from exc
        notes.append({"image_id": image.image_id, "kind": image.kind, "note": _validate_note(answer)})

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
        image_notes=notes,
        model=model,
        generated_at=datetime.now(timezone.utc),
        limitations=[
            "Test output for receiving clinician review; no diagnosis or treatment decision is established from photographs.",
            "Image notes describe visible findings only; call and dispatch context is kept separately.",
        ],
    ).model_dump(mode="json")
