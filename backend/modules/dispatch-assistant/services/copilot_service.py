"""Low-cost OpenRouter narrative layer over fixed operational query results."""

from __future__ import annotations

import json
import os
from typing import Any

from pydantic import BaseModel, Field


COPILOT_MODEL = os.getenv("ANWAR_COPILOT_MODEL", "openai/gpt-4o-mini")


class CopilotNarrative(BaseModel):
    answer: str = Field(description="Direct operational answer in 2 to 4 concise sentences")
    rationale: str = Field(description="Grounded interpretation of the supplied fixed-query rows")
    confidence: float = Field(ge=0, le=1)
    suggested_actions: list[str] = Field(min_length=1, max_length=3)


COPILOT_SYSTEM_PROMPT = (
    "You are ANWAR Dispatch Copilot for Malaysian emergency operations. "
    "The server has already selected and executed a fixed read-only operational query. "
    "Use ONLY the supplied query result. Never invent an incident, unit, ETA, hospital, "
    "capacity, or risk. Do not claim an action was executed. Explain operational trade-offs "
    "concisely and preserve the human approval boundary. If rows are empty, say so plainly. "
    "Return strict JSON matching the supplied schema."
)


def _openrouter_client():
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    return OpenAI(
        api_key=key,
        base_url="https://openrouter.ai/api/v1",
        default_headers={
            "HTTP-Referer": os.getenv("ANWAR_PUBLIC_URL", "http://localhost:3000"),
            "X-OpenRouter-Title": "ANWAR Dispatch Copilot",
        },
        timeout=20.0,
        max_retries=1,
    )


def copilot_answer(
    question: str,
    *,
    context: dict[str, Any],
    incident_id: str | None,
    query_result: dict[str, Any],
    history: list[dict[str, Any]] | None = None,
) -> dict | None:
    """Add a grounded narrative while preserving deterministic visual artifacts."""
    client = _openrouter_client()
    if client is None:
        return None
    payload = {
        "focus_incident_id": incident_id,
        "query": query_result["query"],
        "deterministic_answer": query_result["answer"],
        "deterministic_rationale": query_result["rationale"],
        "artifacts": query_result["artifacts"],
        "limitations": query_result["limitations"],
        "conversation_history": [
            {"question": item.get("question"), "answer": item.get("answer"), "query": item.get("intent")}
            for item in (history or [])[-4:]
        ],
    }
    schema = CopilotNarrative.model_json_schema()
    completion = client.chat.completions.create(
        model=COPILOT_MODEL,
        messages=[
            {"role": "system", "content": COPILOT_SYSTEM_PROMPT},
            {"role": "user", "content": f"Operator question: {question}\n\nFixed query result:\n{json.dumps(payload, default=str)}"},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "anwar_dispatch_copilot", "strict": True, "schema": schema},
        },
        temperature=0.1,
        max_tokens=500,
        extra_body={"provider": {"require_parameters": True}},
    )
    content = completion.choices[0].message.content
    if not content:
        return None
    parsed = CopilotNarrative.model_validate_json(content)
    return {
        **query_result,
        "intent": query_result["query"]["id"],
        "answer": parsed.answer,
        "rationale": parsed.rationale,
        "confidence": round(parsed.confidence, 2),
        "suggested_actions": parsed.suggested_actions[:3],
        "sources": [*query_result["sources"], f"openrouter:{COPILOT_MODEL}"],
        "provider": "openrouter",
        "model": COPILOT_MODEL,
    }
