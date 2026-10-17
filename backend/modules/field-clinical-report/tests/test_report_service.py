from __future__ import annotations

import base64
import importlib
import json
import io
from types import SimpleNamespace

import pytest
import httpx
from fastapi.testclient import TestClient
from openai import OpenAI
from PIL import Image, PngImagePlugin


schemas = importlib.import_module("backend.modules.field-clinical-report.models.schemas")
service = importlib.import_module("backend.modules.field-clinical-report.services.report_service")
router = importlib.import_module("backend.modules.field-clinical-report.api.router")

buffer = io.BytesIO()
Image.new("RGB", (2, 2), "red").save(buffer, format="PNG")
PNG = base64.b64encode(buffer.getvalue()).decode()


class FakeClient:
    def __init__(self, analysis):
        self.analysis = analysis
        self.request = None
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.request = kwargs
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(self.analysis)))])


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


def analysis(image_id="injury-1"):
    return {
        "injury_findings": [{"image_ids": [image_id], "body_region": "lower leg", "observation": "Visible surface wound", "certainty": "visible"}],
        "scene_observations": [], "discrepancies": [], "uncertainties": ["Depth cannot be determined from the image"],
        "handoff_summary": "Reported collision; image shows a visible lower leg surface wound.",
        "hospital_preparation_notes": ["Clinician review of wound image on arrival"],
    }


def test_dgx_omni_request_carries_context_and_image_evidence(monkeypatch):
    monkeypatch.setenv("DGX_VLM_MODEL", "omni")
    client = FakeClient(analysis())
    report = service.generate_draft(make_request(), client=client)
    assert report["status"] == "draft_review_required"
    assert report["dispatch_id"] == "DSP-1"
    assert report["geolocation"]["locality"] == "Bandar Sunway"
    assert report["analysis"]["injury_findings"][0]["image_ids"] == ["injury-1"]
    assert len(report["image_evidence"][0]["sha256"]) == 64
    assert client.request["model"] == "omni"
    user_parts = client.request["messages"][1]["content"]
    assert "Road collision" in user_parts[0]["text"]
    assert user_parts[2]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "data_base64" not in json.dumps(report)


def test_invalid_image_is_rejected_before_vlm_call():
    client = FakeClient(analysis())
    request = make_request(images=[{"image_id": "injury-1", "kind": "injury", "media_type": "image/png", "data_base64": base64.b64encode(b"not a png" * 3).decode()}])
    with pytest.raises(service.InvalidImage):
        service.generate_draft(request, client=client)
    assert client.request is None


def test_uncited_image_reference_is_rejected():
    with pytest.raises(service.InvalidVLMResponse):
        service.generate_draft(make_request(), client=FakeClient(analysis("missing-image")))


def test_embedded_image_metadata_is_not_sent_to_vlm():
    tagged = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("PatientName", "Do not send")
    Image.new("RGB", (2, 2), "red").save(tagged, format="PNG", pnginfo=metadata)
    encoded = base64.b64encode(tagged.getvalue()).decode()
    request = make_request(images=[{"image_id": "injury-1", "kind": "injury", "media_type": "image/png", "data_base64": encoded}])
    client = FakeClient(analysis())
    service.generate_draft(request, client=client)
    data_uri = client.request["messages"][1]["content"][2]["image_url"]["url"]
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
        assert payload["messages"][1]["content"][2]["image_url"]["url"].startswith("data:image/png;base64,")
        return httpx.Response(200, json={
            "id": "chatcmpl-test", "object": "chat.completion", "created": 0, "model": "omni",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(analysis())}}],
        })

    client = OpenAI(base_url="http://dgx.test/v1", api_key="not-used", max_retries=0,
                    http_client=httpx.Client(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr(service, "_client", lambda: client)
    response = TestClient(app).post(
        "/api/field-clinical-report/reports/draft", json=make_request().model_dump(mode="json")
    )

    assert response.status_code == 200, response.text
    assert response.json()["analysis"]["injury_findings"][0]["image_ids"] == ["injury-1"]
    assert len(calls) == 1
