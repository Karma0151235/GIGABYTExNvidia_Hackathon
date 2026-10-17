from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest


schemas = importlib.import_module("backend.modules.case-audit.models.schemas")
service = importlib.import_module("backend.modules.case-audit.services.audit_service")


class FakeClient:
    def __init__(self, content=None, error=None):
        self.content, self.error, self.requests = content, error, []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))])


def request(**changes):
    data = {
        "question": "What were the vitals?",
        "sources": [{"id": "S1", "text": "Vitals: HR 112, SpO2 91%"}, {"id": "S2", "text": "Admitted to CCU"}],
        "history": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
    }
    return schemas.AuditChatRequest.model_validate({**data, **changes})


def test_grounds_answer_in_numbered_sources_and_keeps_known_citations():
    client = FakeClient("HR was 112 [S1] and SpO2 91% [S1]; see also [S9].")
    result = service.answer(request(), client=client)
    sent = client.requests[0]
    assert result == {"answer": "HR was 112 [S1] and SpO2 91% [S1]; see also [S9].", "model": service.AUDIT_MODEL, "cited": ["S1"]}
    assert sent["messages"][0]["role"] == "system"
    assert [m["role"] for m in sent["messages"][1:3]] == ["user", "assistant"]
    assert "[S1] Vitals: HR 112" in sent["messages"][-1]["content"]
    assert sent["extra_body"] == {"chat_template_kwargs": {"enable_thinking": False}}


def test_unreachable_or_empty_model_raises_unavailable():
    with pytest.raises(service.AuditUnavailable, match="unavailable"):
        service.answer(request(), client=FakeClient(error=ConnectionError("refused")))
    with pytest.raises(service.AuditUnavailable, match="no answer"):
        service.answer(request(), client=FakeClient(content=""))


def test_rejects_unnumbered_source_ids():
    with pytest.raises(ValueError):
        request(sources=[{"id": "D1", "text": "x"}])
