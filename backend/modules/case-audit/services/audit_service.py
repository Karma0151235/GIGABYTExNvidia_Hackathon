"""RAG answer step for the audit tab. Retrieval runs in the browser (case state lives there); this grounds the answer."""
from __future__ import annotations

import os
import re
from importlib import import_module


schemas = import_module("backend.modules.case-audit.models.schemas")
AUDIT_MODEL = os.getenv("DGX_AUDIT_MODEL", "nano")

SYSTEM_PROMPT = (
    "You are the Aegis 999 audit assistant. You explain what happened in emergency cases, from the 999 call audio "
    "through triage, ambulance routing, first responder care and hospital admission. "
    "Answer ONLY from the numbered sources in the user's message. Cite every fact inline like [S2]. "
    "If the sources do not contain the answer, say so plainly. Be concise: at most 6 sentences or a short list. "
    "Do not give clinical advice. Plain text, no markdown headings."
)


class AuditUnavailable(RuntimeError):
    pass


def _dgx_client():
    from openai import OpenAI

    return OpenAI(
        api_key="not-used",
        base_url=os.getenv("DGX_AUDIT_BASE_URL", "http://192.168.0.108:9006/v1"),
        timeout=60.0,
        max_retries=0,
    )


def answer(request, *, client=None) -> dict:
    sources = "\n".join(f"[{source.id}] {source.text}" for source in request.sources) or "(no matching records)"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *({"role": message.role, "content": message.content} for message in request.history[-6:]),
        {"role": "user", "content": f"Sources:\n{sources}\n\nQuestion: {request.question}"},
    ]
    try:
        completion = (client or _dgx_client()).chat.completions.create(
            model=AUDIT_MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=1024,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        content = (completion.choices[0].message.content or "").strip()
    except Exception as exc:
        base = os.getenv("DGX_AUDIT_BASE_URL", "http://192.168.0.108:9006/v1")
        raise AuditUnavailable(f"DGX {AUDIT_MODEL} at {base} unavailable: {exc}") from exc
    if not content:
        raise AuditUnavailable(f"DGX {AUDIT_MODEL} returned no answer")
    known = {source.id for source in request.sources}
    cited = list(dict.fromkeys(match for match in re.findall(r"S\d+", content) if match in known))
    return {"answer": content, "model": AUDIT_MODEL, "cited": cited}
