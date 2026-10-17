from __future__ import annotations

import base64
import asyncio
import importlib
import json
import io
from types import SimpleNamespace

import pytest
import httpx
from openai import OpenAI
from PIL import Image, PngImagePlugin


schemas = importlib.import_module("backend.modules.field-clinical-report.models.schemas")
service = importlib.import_module("backend.modules.field-clinical-report.services.report_service")
router = importlib.import_module("backend.modules.field-clinical-report.api.router")

buffer = io.BytesIO()
Image.new("RGB", (2, 2), "red").save(buffer, format="PNG")
PNG = base64.b64encode(buffer.getvalue()).decode()
MP4 = base64.b64encode(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom").decode()


class FakeClient:
    def __init__(self, note):
        self.note = note
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.note))])


def make_request(**changes):
    data = {
        "call_id": "CALL-1", "incident_id": "INC-1", "dispatch_id": "DSP-1",
        "incident_summary": "Road collision with a reported leg injury",
        "geolocation": {"locality": "Bandar Sunway", "latitude": 3.0713838, "longitude": 101.6089714},
        "call_audio_reference": "CALL-1/audio",
        "receiving_facility_id": "hkl", "hospital_eta_minutes": 12,
        "images": [{"image_id": "injury-1", "kind": "injury", "media_type": "image/png", "data_base64": PNG}],
    }
    data.update(changes)
    return schemas.ReportRequest(**data)


NOTE = """ER TRIAGE NOTE (TEST OUTPUT ONLY)
======================================================================
TRIAGE: CANNOT DETERMINE
No clear injury visible.
----------------------------------------------------------------------
INJURIES
None visible
----------------------------------------------------------------------
BLEEDING
Overall: NONE VISIBLE
Control visible: none
----------------------------------------------------------------------
PATIENT (VISIBLE ONLY)
Position: cannot assess
Responsiveness: cannot assess
Breathing: cannot assess
----------------------------------------------------------------------
OTHER FINDINGS
None visible
----------------------------------------------------------------------
HAZARDS AFFECTING CARE
None visible
----------------------------------------------------------------------
NOT ASSESSABLE FROM IMAGE
airway, vital signs, mechanism, time since injury
----------------------------------------------------------------------
Image check: uncertain
Not a medical or legal assessment."""


def test_dgx_omni_request_carries_context_and_image_evidence(monkeypatch):
    monkeypatch.setenv("DGX_VLM_MODEL", "omni")
    client = FakeClient(NOTE)
    report = service.generate_draft(make_request(), client=client)
    assert report["status"] == "draft_review_required"
    assert report["dispatch_id"] == "DSP-1"
    assert report["geolocation"]["locality"] == "Bandar Sunway"
    assert report["image_notes"] == [{"image_id": "injury-1", "kind": "injury", "note": NOTE}]
    assert len(report["image_evidence"][0]["sha256"]) == 64
    request = client.requests[0]
    assert request["model"] == "omni"
    assert request["extra_body"] == {"chat_template_kwargs": {"enable_thinking": False}}
    assert request["messages"][0]["content"] == service.SYSTEM_PROMPT
    assert "ER TRIAGE NOTE (TEST OUTPUT ONLY)" in service.SYSTEM_PROMPT
    assert "Visual evidence may not reliably show breathing or responsiveness." in service.SYSTEM_PROMPT
    user_parts = request["messages"][1]["content"]
    assert "Road collision" not in user_parts[0]["text"]
    assert user_parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "data_base64" not in json.dumps(report)


def test_invalid_image_is_rejected_before_vlm_call():
    client = FakeClient(NOTE)
    request = make_request(images=[{"image_id": "injury-1", "kind": "injury", "media_type": "image/png", "data_base64": base64.b64encode(b"not a png" * 3).decode()}])
    with pytest.raises(service.InvalidImage):
        service.generate_draft(request, client=client)
    assert not client.requests


def test_invalid_note_layout_is_rejected():
    with pytest.raises(service.InvalidVLMResponse):
        service.generate_draft(make_request(), client=FakeClient('{"injury_findings": []}'))


def test_video_is_sent_to_dgx_and_report_contains_only_vlm_note():
    client = FakeClient(NOTE)
    report = service.generate_draft(make_request(images=[], video={
        "video_id": "responder-feed", "media_type": "video/mp4", "data_base64": MP4,
    }), client=client)

    assert report["video_note"] == NOTE
    assert report["image_notes"] == []
    assert len(report["video_sha256"]) == 64
    assert client.requests[0]["messages"][0]["content"] == service.SYSTEM_PROMPT
    assert client.requests[0]["messages"][1]["content"][1]["video_url"]["url"].startswith("data:video/mp4;base64,")
    assert client.requests[0]["extra_body"]["mm_processor_kwargs"] == {"use_audio_in_video": False}


def test_dgx_video_400_retries_with_real_video_frames():
    calls = []

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if len(calls) == 1:
            assert payload["messages"][1]["content"][1]["type"] == "video_url"
            return httpx.Response(400, json={"error": {"message": "video loader unsupported"}})
        assert payload["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
        return httpx.Response(200, json={
            "id": "chatcmpl-frames", "object": "chat.completion", "created": 0, "model": "omni",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": NOTE}}],
        })

    client = OpenAI(base_url="http://dgx.test/v1", api_key="not-used", max_retries=0,
                    http_client=httpx.Client(transport=httpx.MockTransport(respond)))
    report = service.generate_draft(make_request(images=[], video={
        "video_id": "responder-feed", "media_type": "video/mp4", "data_base64": MP4,
    }, video_frames=[{
        "image_id": "video-frame-1", "kind": "other", "media_type": "image/png", "data_base64": PNG,
    }]), client=client)
    assert report["video_note"] == NOTE
    assert report["video_method"] == "frames"
    assert len(calls) == 2


def test_dgx_400_without_frames_exposes_rejection():
    def respond(_request):
        return httpx.Response(400, json={"error": {"message": "unsupported video_url"}})

    client = OpenAI(base_url="http://dgx.test/v1", api_key="not-used", max_retries=0,
                    http_client=httpx.Client(transport=httpx.MockTransport(respond)))
    with pytest.raises(service.VLMRejected, match="unsupported video_url"):
        service.generate_draft(make_request(images=[], video={
            "video_id": "responder-feed", "media_type": "video/mp4", "data_base64": MP4,
        }), client=client)


def test_invalid_video_is_rejected_without_a_fallback_report():
    client = FakeClient(NOTE)
    with pytest.raises(service.InvalidVideo):
        service.generate_draft(make_request(images=[], video={
            "video_id": "bad", "media_type": "video/mp4", "data_base64": base64.b64encode(b"not an mp4 video").decode(),
        }), client=client)
    assert client.requests == []


def test_empty_vlm_video_response_is_rejected():
    with pytest.raises(service.InvalidVLMResponse):
        service.generate_draft(make_request(images=[], video={
            "video_id": "responder-feed", "media_type": "video/mp4", "data_base64": MP4,
        }), client=FakeClient(None))


def test_multiple_images_get_separate_single_image_notes():
    request = make_request(images=[
        {"image_id": "injury-1", "kind": "injury", "media_type": "image/png", "data_base64": PNG},
        {"image_id": "site-1", "kind": "incident_site", "media_type": "image/png", "data_base64": PNG},
    ])
    client = FakeClient(NOTE)
    report = service.generate_draft(request, client=client)
    assert [item["image_id"] for item in report["image_notes"]] == ["injury-1", "site-1"]
    assert len(client.requests) == 2
    assert all(len(call["messages"][1]["content"]) == 2 for call in client.requests)


def test_embedded_image_metadata_is_not_sent_to_vlm():
    tagged = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("PatientName", "Do not send")
    Image.new("RGB", (2, 2), "red").save(tagged, format="PNG", pnginfo=metadata)
    encoded = base64.b64encode(tagged.getvalue()).decode()
    request = make_request(images=[{"image_id": "injury-1", "kind": "injury", "media_type": "image/png", "data_base64": encoded}])
    client = FakeClient(NOTE)
    service.generate_draft(request, client=client)
    data_uri = client.requests[0]["messages"][1]["content"][1]["image_url"]["url"]
    with Image.open(io.BytesIO(base64.b64decode(data_uri.split(",", 1)[1]))) as sent:
        assert "PatientName" not in sent.info


def test_module_router_is_discoverable():
    assert {route.path for route in router.router.routes} >= {"/health", "/reports/draft"}


def test_http_draft_route_sends_openai_compatible_multimodal_request(monkeypatch):
    from backend.server import app

    calls = []

    def respond(request):
        calls.append(request)
        assert request.method == "POST"
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["model"] == "omni"
        assert payload["chat_template_kwargs"] == {"enable_thinking": False}
        assert payload["messages"][0]["content"] == service.SYSTEM_PROMPT
        assert payload["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
        return httpx.Response(200, json={
            "id": "chatcmpl-test", "object": "chat.completion", "created": 0, "model": "omni",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": NOTE}}],
        })

    client = OpenAI(base_url="http://dgx.test/v1", api_key="not-used", max_retries=0,
                    http_client=httpx.Client(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr(service, "_client", lambda: client)
    async def post_report():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
            return await api.post(
                "/api/field-clinical-report/reports/draft", json=make_request().model_dump(mode="json")
            )

    response = asyncio.run(post_report())

    assert response.status_code == 200, response.text
    assert response.json()["image_notes"][0]["note"] == NOTE
    assert len(calls) == 1


def test_http_video_report_sends_mp4_to_omni(monkeypatch):
    from backend.server import app

    calls = []

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert request.url.path == "/v1/chat/completions"
        assert payload["messages"][1]["content"][1]["video_url"]["url"].startswith("data:video/mp4;base64,")
        return httpx.Response(200, json={
            "id": "chatcmpl-video", "object": "chat.completion", "created": 0, "model": "omni",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": NOTE}}],
        })

    client = OpenAI(base_url="http://dgx.test/v1", api_key="not-used", max_retries=0,
                    http_client=httpx.Client(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr(service, "_client", lambda: client)

    async def post_report():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
            return await api.post("/api/field-clinical-report/reports/draft", json=make_request(
                images=[], video={"video_id": "responder-feed", "media_type": "video/mp4", "data_base64": MP4},
            ).model_dump(mode="json"))

    response = asyncio.run(post_report())
    assert response.status_code == 200, response.text
    assert response.json()["video_note"] == NOTE
    assert len(calls) == 1


def test_http_video_report_rejects_empty_vlm_output(monkeypatch):
    from backend.server import app

    monkeypatch.setattr(service, "_client", lambda: FakeClient(None))

    async def post_report():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
            return await api.post("/api/field-clinical-report/reports/draft", json=make_request(
                images=[], video={"video_id": "responder-feed", "media_type": "video/mp4", "data_base64": MP4},
            ).model_dump(mode="json"))

    response = asyncio.run(post_report())
    assert response.status_code == 502
    assert "VLM returned no final report content" in response.json()["detail"]


def test_http_video_400_returns_upstream_reason_instead_of_offline(monkeypatch):
    from backend.server import app

    client = OpenAI(base_url="http://dgx.test/v1", api_key="not-used", max_retries=0,
                    http_client=httpx.Client(transport=httpx.MockTransport(
                        lambda _request: httpx.Response(400, json={"error": {"message": "video decoder unavailable"}})
                    )))
    monkeypatch.setattr(service, "_client", lambda: client)

    async def post_report():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
            return await api.post("/api/field-clinical-report/reports/draft", json=make_request(
                images=[], video={"video_id": "responder-feed", "media_type": "video/mp4", "data_base64": MP4},
            ).model_dump(mode="json"))

    response = asyncio.run(post_report())
    assert response.status_code == 502
    assert "video decoder unavailable" in response.json()["detail"]
