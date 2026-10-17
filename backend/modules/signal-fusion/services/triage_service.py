"""999 call triage: recording -> transcript -> decision tree -> dispatch summary JSON.

Decision tree (run_tree): speech? -> genuine? -> life threat? -> urgent?
Silent and spam calls end at the tree; emergencies carry a summary forward for routing.

Extraction uses DGX Spark, with a deterministic keyword fallback.
"""

from __future__ import annotations

import base64
import binascii
import mimetypes
import os
import re
import uuid
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[4]
TRIAGE_MODEL = os.environ.get("DGX_TRIAGE_MODEL", "lightning")
STT_MODEL = os.environ.get("DGX_STT_MODEL", "omni")
MAX_AUDIO_BYTES = 6_000_000
AUDIO_DIR = Path(os.environ.get("ANWAR_CALL_AUDIO_DIR", ROOT / "backend" / "data" / "call-audio"))
VOICE_SAMPLES_DIR = ROOT / "voice_samples"
ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav"}

# ponytail: mock geocoder, KL + PJ landmarks first so they win when a call names several places.
# Swap for a real geocoder (Google / Nominatim) post-hackathon.
GAZETTEER: dict[str, tuple[float, float, str]] = {
    "klcc": (3.1579, 101.7123, "Kuala Lumpur"),
    "petronas": (3.1579, 101.7123, "Kuala Lumpur"),
    "kl sentral": (3.1340, 101.6865, "Kuala Lumpur"),
    # STT spelling variants seen from Scribe on the demo calls.
    "kl central": (3.1340, 101.6865, "Kuala Lumpur"),
    "kl center": (3.1340, 101.6865, "Kuala Lumpur"),
    "jalan tuanku abdul rahman": (3.1585, 101.6964, "Kuala Lumpur"),
    "jalan tun razak": (3.1611, 101.7186, "Kuala Lumpur"),
    "masjid jamek": (3.1488, 101.6958, "Kuala Lumpur"),
    "bukit bintang": (3.1468, 101.7113, "Kuala Lumpur"),
    "pavilion": (3.1490, 101.7133, "Kuala Lumpur"),
    "chow kit": (3.1637, 101.6982, "Kuala Lumpur"),
    "titiwangsa": (3.1810, 101.7050, "Kuala Lumpur"),
    "wangsa maju": (3.2050, 101.7370, "Kuala Lumpur"),
    "wangsa": (3.1810, 101.7050, "Kuala Lumpur"),
    "bangsar": (3.1301, 101.6710, "Kuala Lumpur"),
    "mid valley": (3.1176, 101.6774, "Kuala Lumpur"),
    "cheras": (3.0863, 101.7472, "Kuala Lumpur"),
    "sungai besi": (3.0614, 101.7089, "Kuala Lumpur"),
    "petaling jaya": (3.1073, 101.6067, "Petaling Jaya"),
    "damansara": (3.1349, 101.6236, "Petaling Jaya"),
    "kelana jaya": (3.1123, 101.6043, "Petaling Jaya"),
    "1 utama": (3.1502, 101.6154, "Petaling Jaya"),
    "ss2": (3.1180, 101.6216, "Petaling Jaya"),
    "sunway": (3.0674, 101.6035, "Subang Jaya"),
    "subang": (3.0567, 101.5851, "Subang Jaya"),
    "ampang": (3.1500, 101.7614, "Ampang Jaya"),
}
KL_CENTER = (3.1390, 101.6869)


class TriageExtraction(BaseModel):
    """Structured facts an emergency dispatcher needs from a call."""

    call_class: Literal["emergency", "spam"] = Field(
        description="spam = prank, test, joke, misdial or no request for help; otherwise emergency"
    )
    location_name: str = Field(description="Place mentioned by the caller, as spoken; 'unknown' if none")
    patient_count: int = Field(ge=0, description="Number of patients, 0 if unknown")
    conscious: bool | None = Field(description="Is the patient conscious? null if not stated")
    breathing: bool | None = Field(description="Is the patient breathing? null if not stated")
    condition_summary: str = Field(description="Chief complaint / situation in one English sentence")
    priority: Literal["P1", "P2", "P3"] = Field(description="P1 life-threatening, P2 urgent, P3 non-urgent")
    rationale: str = Field(description="One-sentence justification for the priority")
    confidence: float = Field(ge=0, le=1, description="Confidence in the priority, 0-1")


TRIAGE_SYSTEM_PROMPT = (
    "You triage Malaysian 999 emergency medical calls. Callers speak Malay, English, "
    "Manglish (code-switched Malay/English), Mandarin, or Tamil. Extract dispatch facts. "
    "Priority rubric: P1 = life-threatening (unconscious, not breathing, chest pain, severe "
    "bleeding, major trauma, 'tak sedar', 'tak bernafas', 'sakit dada'); P2 = urgent but "
    "stable; P3 = non-urgent. Emergency triage tends to over-assign severity: only choose P1 "
    "with concrete life-threat evidence, and reflect uncertainty in the confidence score. "
    "Set call_class='spam' only for clear pranks, test calls, jokes or misdials with no request "
    "for help; when unsure, choose 'emergency'. A human dispatcher reviews every result."
)

P1_KEYWORDS = (
    "not breathing", "cannot breathe", "can't breathe", "unconscious", "chest pain", "cardiac",
    "heart attack", "stroke", "collapsed", "severe bleeding", "banyak darah", "not moving",
    "tak bergerak", "tak sedar", "tak bernafas", "sakit dada", "pengsan", "lemas",
)
P2_KEYWORDS = (
    "accident", "fracture", "broken", "kemalangan", "patah", "断", "bleeding", "berdarah",
    "gas", "pening", "muntah", "banjir", "air naik", "tersangkut",
)
SPAM_KEYWORDS = (
    "prank", "just kidding", "joking", "saja test", "test call", "testing testing", "main-main",
    "gurau", "wrong number", "salah nombor", "hahaha", "ha ha ha",
)
UNCONSCIOUS_KEYWORDS = ("unconscious", "not conscious", "tak sedar", "tidak sedar", "pengsan", "unresponsive")
NOT_BREATHING_KEYWORDS = ("not breathing", "tak bernafas", "tidak bernafas", "no breathing", "stopped breathing")
# "no heavy bleeding" must not read as bleeding; only applied to the P2 check so "not breathing" survives for P1.
NEGATED_PHRASE = re.compile(r"\b(no|tiada|tak ada)\s+(heavy\s+|serious\s+)?\w+")
# Scribe tags non-speech like "(silence)" or "[static]"; strip before counting words.
AUDIO_EVENT_TAG = re.compile(r"[(\[][^)\]]*[)\]]")
MIN_SPEECH_WORDS = 3


def _llm_client():
    try:
        from openai import OpenAI
    except ImportError:
        return None, None
    return OpenAI(
        api_key="not-used",
        base_url=os.environ.get("DGX_TRIAGE_BASE_URL", "http://192.168.0.108:9000/v1"),
        timeout=60.0,
        max_retries=0,
    ), os.environ.get("DGX_TRIAGE_MODEL", TRIAGE_MODEL)


def _stt_client():
    from openai import OpenAI

    return OpenAI(
        api_key="not-used",
        base_url=os.environ.get("DGX_STT_BASE_URL", "http://192.168.0.108:9001/v1"),
        timeout=90.0,
        max_retries=0,
    )


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


def _scribe(audio_bytes: bytes, filename: str) -> str:
    content_type = "audio/mpeg" if Path(filename).suffix.lower() == ".mp3" else "audio/wav"
    audio_url = f"data:{content_type};base64,{base64.b64encode(audio_bytes).decode('ascii')}"
    result = _stt_client().chat.completions.create(
        model=os.environ.get("DGX_STT_MODEL", STT_MODEL),
        messages=[{"role": "user", "content": [
            {"type": "audio_url", "audio_url": {"url": audio_url}},
            {"type": "text", "text": "Transcribe this emergency call verbatim. Return only the spoken words."},
        ]}],
        max_tokens=2048,
        temperature=0.2,
        extra_body={"top_k": 1, "chat_template_kwargs": {"enable_thinking": False}},
    )
    # Empty transcript is a silent call; run_tree classifies it.
    return (result.choices[0].message.content or "").strip()


def transcribe_audio(audio_base64: str, filename: str = "call.mp3") -> str:
    audio_bytes, _ = decode_audio(audio_base64, filename)
    return _scribe(audio_bytes, filename)


def list_samples() -> list[str]:
    return sorted(path.name for path in VOICE_SAMPLES_DIR.glob("*.mp3")) if VOICE_SAMPLES_DIR.exists() else []


def resolve_sample(name: str) -> Path | None:
    # Whitelist by listing, so a crafted name can never escape the samples folder.
    return VOICE_SAMPLES_DIR / name if name in list_samples() else None


def transcribe_sample(name: str) -> str:
    path = resolve_sample(name)
    if path is None:
        raise ValueError(f"unknown voice sample: {name}")
    return _scribe(path.read_bytes(), name)


def triage_transcript(transcript: str) -> tuple[TriageExtraction, str]:
    """Returns (extraction, provider) where provider is 'llm' or 'heuristic'."""
    client, model = _llm_client()
    if client is not None:
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": TRIAGE_SYSTEM_PROMPT + " Return only JSON matching this schema: " + str(TriageExtraction.model_json_schema())},
                    {"role": "user", "content": transcript},
                ],
                response_format={"type": "json_object"},
                max_tokens=2048,
                temperature=0.2,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
            content = completion.choices[0].message.content
            if content:
                return TriageExtraction.model_validate_json(content), "llm"
        except Exception:
            pass
    return _heuristic_triage(transcript), "heuristic"


def _heuristic_triage(transcript: str) -> TriageExtraction:
    lowered = transcript.lower()
    p1 = any(k in lowered for k in P1_KEYWORDS)
    p2 = any(k in NEGATED_PHRASE.sub(" ", lowered) for k in P2_KEYWORDS)
    if p1:
        priority, rationale = "P1", "Life-threat keyword detected in transcript"
    elif p2:
        priority, rationale = "P2", "Urgent-injury keyword detected in transcript"
    else:
        priority, rationale = "P3", "No urgency keywords detected"
    # ponytail: spam needs positive evidence; ambiguous calls stay emergency so none are dropped
    spam = any(k in lowered for k in SPAM_KEYWORDS) and not (p1 or p2)
    if any(k in lowered for k in UNCONSCIOUS_KEYWORDS):
        conscious = False
    elif "sedar" in lowered or "conscious" in lowered or "awake" in lowered:
        conscious = True
    else:
        conscious = None
    location_name = next((name for name in GAZETTEER if name in lowered), None)
    if location_name is None:
        places = import_module("backend.modules.live-dispatch.services.mock_call_service")
        try:
            location_name = places.resolve_place(transcript)["name"]
        except places.PlaceNotFound:
            location_name = "unknown"
    return TriageExtraction(
        call_class="spam" if spam else "emergency",
        location_name=location_name,
        patient_count=1,
        conscious=conscious,
        breathing=False if any(k in lowered for k in NOT_BREATHING_KEYWORDS) else None,
        condition_summary=transcript[:160],
        priority=priority,
        rationale=rationale,
        confidence=0.35,
    )


class TreeStep(BaseModel):
    question: str
    answer: str


class TriageDecision(BaseModel):
    call_class: Literal["silent", "spam", "emergency"]
    priority: Literal["P1", "P2", "P3"] | None = None
    path: list[TreeStep]
    missing_fields: list[str] = []


def speech_word_count(transcript: str) -> int:
    return len(AUDIO_EVENT_TAG.sub(" ", transcript).split())


def _yes(flag: bool) -> str:
    return "yes" if flag else "no"


def run_tree(transcript: str) -> tuple[TriageDecision, TriageExtraction | None, str | None]:
    """Walk the triage tree. Returns (decision, extraction, provider); extraction is None for silent calls."""
    words = speech_word_count(transcript)
    path = [TreeStep(question="Speech detected?", answer=f"{_yes(words >= MIN_SPEECH_WORDS)} ({words} words)")]
    if words < MIN_SPEECH_WORDS:
        return TriageDecision(call_class="silent", path=path), None, None

    extraction, provider = triage_transcript(transcript)
    spam = extraction.call_class == "spam"
    path.append(TreeStep(question="Genuine request for help?", answer="no (prank / test / misdial)" if spam else "yes"))
    if spam:
        return TriageDecision(call_class="spam", path=path), extraction, provider

    life_threat = extraction.conscious is False or extraction.breathing is False or extraction.priority == "P1"
    path.append(TreeStep(question="Life threat?", answer=_yes(life_threat)))
    if life_threat:
        priority = "P1"
    else:
        urgent = extraction.priority == "P2"
        path.append(TreeStep(question="Urgent?", answer=_yes(urgent)))
        priority = "P2" if urgent else "P3"

    missing = [
        name
        for name, absent in (
            ("location", locate(extraction.location_name)["lat"] is None),
            ("patients", extraction.patient_count == 0),
            ("conscious", extraction.conscious is None),
            ("breathing", extraction.breathing is None),
        )
        if absent
    ]
    return TriageDecision(call_class="emergency", priority=priority, path=path, missing_fields=missing), extraction, provider


def locate(location_name: str) -> dict:
    lowered = location_name.lower()
    for name, (lat, lng, area) in GAZETTEER.items():
        if name in lowered:
            return {"text": location_name, "area": area, "lat": lat, "lng": lng}
    return {"text": None if lowered in ("", "unknown") else location_name, "area": None, "lat": None, "lng": None}


def build_summary(transcript: str, decision: TriageDecision, extraction: TriageExtraction | None) -> dict:
    """Handoff JSON for routing/dispatch. Non-emergency calls keep only class + transcript."""
    emergency = extraction is not None and decision.call_class == "emergency"
    return {
        "call_id": f"CALL-{uuid.uuid4().hex[:8].upper()}",
        "received_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "call_class": decision.call_class,
        "priority": decision.priority,
        "location": locate(extraction.location_name) if emergency else None,
        "patients": extraction.patient_count if emergency else None,
        "conscious": extraction.conscious if emergency else None,
        "breathing": extraction.breathing if emergency else None,
        "complaint": extraction.condition_summary if emergency else None,
        "missing": decision.missing_fields,
        "transcript": transcript,
    }
