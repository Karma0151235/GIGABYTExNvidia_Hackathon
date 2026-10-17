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
