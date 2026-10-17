"""LLM call triage: transcript -> structured extraction -> Signal Fusion ingest payload.

Uses OpenAI when OPENAI_API_KEY is set; otherwise falls back to a
deterministic keyword heuristic so the pipeline always produces a triage card.
"""

from __future__ import annotations

import base64
import binascii
import io
import mimetypes
import os
import re
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

TRIAGE_MODEL = os.environ.get("ANWAR_TRIAGE_MODEL", "gpt-4o-mini")
ELEVENLABS_STT_MODEL = os.environ.get("ELEVENLABS_STT_MODEL", "scribe_v2")
MAX_AUDIO_BYTES = 6_000_000
AUDIO_DIR = Path(
    os.environ.get(
        "ANWAR_CALL_AUDIO_DIR",
        Path(__file__).resolve().parents[3] / "data" / "call-audio",
    )
)
ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".webm", ".m4a", ".mp4", ".ogg"}

# ponytail: tiny KL gazetteer for demo geocoding; swap for a real geocoder post-hackathon
GAZETTEER: dict[str, tuple[float, float]] = {
    "klcc": (3.1579, 101.7123),
    "petronas": (3.1579, 101.7123),
    "bukit bintang": (3.1468, 101.7113),
    "pavilion": (3.1490, 101.7133),
    "mid valley": (3.1176, 101.6774),
    "kl sentral": (3.1340, 101.6865),
    "chow kit": (3.1637, 101.6982),
    "cheras": (3.0863, 101.7472),
    "ampang": (3.1500, 101.7614),
    "petaling jaya": (3.1073, 101.6067),
    "subang": (3.0567, 101.5851),
    "sunway": (3.0674, 101.6035),
    "bangsar": (3.1301, 101.6710),
    "titiwangsa": (3.1810, 101.7050),
    "sungai besi": (3.0614, 101.7089),
}
KL_CENTER = (3.1390, 101.6869)


class TriageExtraction(BaseModel):
    """Structured facts an emergency dispatcher needs from a call."""

    location_name: str = Field(description="Place mentioned by the caller, as spoken")
    patient_count: int = Field(ge=0, description="Number of patients, 0 if unknown")
    condition_summary: str = Field(description="Chief complaint / situation in one English sentence")
    priority: Literal["P1", "P2", "P3"] = Field(
        description="P1 life-threatening, P2 urgent, P3 non-urgent"
    )
    rationale: str = Field(description="One-sentence justification for the priority")
    confidence: float = Field(ge=0, le=1, description="Confidence in the priority, 0-1")
    caller_language: str = Field(description="Language(s) detected, e.g. 'Malay/English code-switching'")
    english_summary: str = Field(description="Full English summary of the call")


TRIAGE_SYSTEM_PROMPT = (
    "You triage Malaysian 999 emergency medical calls. Callers speak Malay, English, "
    "Manglish (code-switched Malay/English), Mandarin, or Tamil. Extract dispatch facts. "
    "Priority rubric: P1 = life-threatening (unconscious, not breathing, chest pain, severe "
    "bleeding, major trauma, 'tak sedar', 'tak bernafas', 'sakit dada'); P2 = urgent but "
    "stable; P3 = non-urgent. Emergency triage tends to over-assign severity: only choose P1 "
    "with concrete life-threat evidence, and reflect uncertainty in the confidence score. "
    "A human dispatcher reviews every result."
)

P1_KEYWORDS = (
    "not breathing", "unconscious", "chest pain", "cardiac", "heart attack", "stroke",
    "severe bleeding", "tak sedar", "tak bernafas", "sakit dada", "pengsan", "lemas",
)
P2_KEYWORDS = ("accident", "fracture", "broken", "kemalangan", "patah", "bleeding", "berdarah")


def _openai_client():
    if not os.environ.get("OPENAI_API_KEY"):
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    return OpenAI()


def _elevenlabs_client():
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is required for audio transcription")
    from elevenlabs.client import ElevenLabs

    return ElevenLabs(api_key=api_key)


def decode_audio(audio_base64: str, filename: str) -> tuple[bytes, str]:
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_AUDIO_EXTENSIONS:
        supported = ", ".join(sorted(ALLOWED_AUDIO_EXTENSIONS))
        raise ValueError(f"unsupported audio type; use {supported}")
    try:
        audio_bytes = base64.b64decode(audio_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("audio_base64 must be valid base64") from exc
    if not audio_bytes:
        raise ValueError("audio recording is empty")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError("audio recording exceeds the 6 MB limit")
    return audio_bytes, extension


def store_audio(audio_base64: str, filename: str) -> dict[str, str | int]:
    audio_bytes, extension = decode_audio(audio_base64, filename)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    audio_id = uuid.uuid4().hex
    destination = AUDIO_DIR / f"{audio_id}{extension}"
    destination.write_bytes(audio_bytes)
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return {
        "id": audio_id,
        "filename": Path(filename).name,
        "content_type": content_type,
        "size_bytes": len(audio_bytes),
        "url": f"/api/signal-fusion/audio/{audio_id}",
    }


def resolve_audio(audio_id: str) -> Path | None:
    if not re.fullmatch(r"[0-9a-f]{32}", audio_id):
        return None
    if not AUDIO_DIR.exists():
        return None
    return next((path for path in AUDIO_DIR.glob(f"{audio_id}.*") if path.is_file()), None)


def transcribe_audio(audio_base64: str, filename: str = "call.webm") -> str:
    audio_bytes, _ = decode_audio(audio_base64, filename)
    audio = io.BytesIO(audio_bytes)
    audio.name = filename
    result = _elevenlabs_client().speech_to_text.convert(
        file=audio,
        model_id=ELEVENLABS_STT_MODEL,
        language_code=None,
        tag_audio_events=True,
        diarize=True,
    )
    transcript = result.text.strip()
    if not transcript:
        raise ValueError("ElevenLabs returned an empty transcript")
    return transcript


def triage_transcript(transcript: str) -> tuple[TriageExtraction, str]:
    """Returns (extraction, provider) where provider is 'llm' or 'heuristic'."""
    client = _openai_client()
    if client is not None:
        completion = client.chat.completions.parse(
            model=TRIAGE_MODEL,
            messages=[
                {"role": "system", "content": TRIAGE_SYSTEM_PROMPT},
                {"role": "user", "content": transcript},
            ],
            response_format=TriageExtraction,
        )
        parsed = completion.choices[0].message.parsed
        if parsed is not None:
            return parsed, "llm"
    return _heuristic_triage(transcript), "heuristic"


def _heuristic_triage(transcript: str) -> TriageExtraction:
    lowered = transcript.lower()
    if any(k in lowered for k in P1_KEYWORDS):
        priority, rationale = "P1", "Life-threat keyword detected in transcript"
    elif any(k in lowered for k in P2_KEYWORDS):
        priority, rationale = "P2", "Urgent-injury keyword detected in transcript"
    else:
        priority, rationale = "P3", "No urgency keywords detected"
    location = next((name for name in GAZETTEER if name in lowered), "unknown")
    return TriageExtraction(
        location_name=location,
        patient_count=1,
        condition_summary=transcript[:160],
        priority=priority,
        rationale=rationale,
        confidence=0.35,
        caller_language="unknown",
        english_summary=transcript[:300],
    )


def geocode(location_name: str, fallback: tuple[float, float] | None = None) -> tuple[float, float]:
    lowered = location_name.lower()
    for name, coords in GAZETTEER.items():
        if name in lowered:
            return coords
    return fallback or KL_CENTER
