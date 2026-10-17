import base64
import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
triage_service = importlib.import_module(
    "backend.modules.signal-fusion.services.triage_service"
)


def test_transcribe_audio_uses_elevenlabs_scribe(monkeypatch):
    calls = {}

    class Result:
        text = "Tak sedar di KLCC"

    class SpeechToText:
        def convert(self, **kwargs):
            calls.update(kwargs)
            return Result()

    class Client:
        speech_to_text = SpeechToText()

    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setattr(triage_service, "_elevenlabs_client", lambda: Client())

    transcript = triage_service.transcribe_audio(
        base64.b64encode(b"audio").decode(), "call.webm"
    )

    assert transcript == "Tak sedar di KLCC"
    assert calls["model_id"] == "scribe_v2"
    assert calls["tag_audio_events"] is True
    assert calls["diarize"] is True
    assert calls["language_code"] is None
    assert calls["file"].name == "call.webm"


def test_transcribe_audio_rejects_invalid_base64():
    with pytest.raises(ValueError, match="valid base64"):
        triage_service.transcribe_audio("not base64!", "call.webm")


def test_store_audio_preserves_validated_evidence(monkeypatch):
    written = {}
    monkeypatch.setattr(Path, "mkdir", lambda self, **kwargs: None)
    monkeypatch.setattr(Path, "write_bytes", lambda self, data: written.update(path=self, data=data))
    encoded = base64.b64encode(b"fake-mp3-audio").decode()

    evidence = triage_service.store_audio(encoded, "999-call.mp3")

    assert written["data"] == b"fake-mp3-audio"
    assert written["path"].suffix == ".mp3"
    assert evidence["filename"] == "999-call.mp3"
    assert evidence["content_type"] == "audio/mpeg"
    assert evidence["url"].endswith(evidence["id"])


def test_transcribe_audio_rejects_unsupported_file_type():
    encoded = base64.b64encode(b"not-audio").decode()
    with pytest.raises(ValueError, match="unsupported audio type"):
        triage_service.transcribe_audio(encoded, "call.txt")


@pytest.mark.parametrize(
    ("transcript", "call_class", "priority"),
    [
        ("", "silent", None),
        ("(silence) [static] hello", "silent", None),
        ("hahaha prank call je, saja test line 999", "spam", None),
        ("Tolong, dekat KLCC ayah saya tak sedar dan tak bernafas", "emergency", "P1"),
        ("Kemalangan dekat Cheras, kaki patah tapi dia sedar", "emergency", "P2"),
        ("My neighbour feels a bit dizzy, can someone come check", "emergency", "P3"),
        # Spam words beside real distress must never be filtered out.
        ("This is not a prank, my friend is unconscious at Bangsar", "emergency", "P1"),
    ],
)
def test_run_tree_classifies_calls(monkeypatch, transcript, call_class, priority):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    decision, extraction, _ = triage_service.run_tree(transcript)
    assert decision.call_class == call_class
    assert decision.priority == priority
    assert (extraction is None) == (call_class == "silent")


def test_run_tree_flags_missing_location(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    decision, extraction, _ = triage_service.run_tree("Someone collapsed and is unconscious, please hurry")
    assert "location" in decision.missing_fields
    summary = triage_service.build_summary("x", decision, extraction)
    assert summary["location"]["lat"] is None


def test_locate_prefers_kl_and_pj_landmarks():
    assert triage_service.locate("klcc concourse")["area"] == "Kuala Lumpur"
    assert triage_service.locate("Petaling Jaya")["area"] == "Petaling Jaya"
    assert triage_service.locate("somewhere")["lat"] is None


def test_resolve_sample_blocks_path_traversal():
    assert triage_service.resolve_sample("../backend/.env") is None
