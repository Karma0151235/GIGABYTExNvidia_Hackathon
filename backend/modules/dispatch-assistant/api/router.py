from __future__ import annotations

from importlib import import_module

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool


schemas = import_module("backend.modules.dispatch-assistant.models.schemas")
service_module = import_module("backend.modules.dispatch-assistant.services.assistant_service")
store_module = import_module("backend.modules.dispatch-assistant.services.store")
service = service_module.service

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "module": "dispatch-assistant",
        "mode": "dgx-with-deterministic-fallback",
        "model": service_module.copilot_service.COPILOT_MODEL,
        "query_execution": "fixed-read-only-catalog",
        "actions": "recommendation-only",
    }


@router.post("/query", response_model=schemas.AssistantResponse)
async def query(payload: schemas.AssistantQuery):
    try:
        return service.query(payload.question, incident_id=payload.incident_id, session_id=payload.session_id)
    except store_module.AssistantStorageUnavailable as exc:
        raise HTTPException(503, {"code": "dispatch_assistant_storage_unavailable", "message": str(exc)}) from exc


@router.post("/copilot", response_model=schemas.CopilotResponse)
async def copilot(payload: schemas.AssistantQuery):
    try:
        return await run_in_threadpool(
            service.copilot, payload.question,
            incident_id=payload.incident_id, session_id=payload.session_id,
        )
    except store_module.AssistantStorageUnavailable as exc:
        raise HTTPException(503, {"code": "dispatch_assistant_storage_unavailable", "message": str(exc)}) from exc


@router.get("/sessions/{session_id}", response_model=list[schemas.SessionEntry])
async def session(session_id: str):
    try:
        return service.session(session_id)
    except store_module.AssistantStorageUnavailable as exc:
        raise HTTPException(503, {"code": "dispatch_assistant_storage_unavailable", "message": str(exc)}) from exc


@router.get("/sop/{topic}", response_model=schemas.SopSnippet)
async def sop(topic: str):
    snippet = service.sop(topic)
    if snippet is None:
        raise HTTPException(404, "SOP topic not found")
    return snippet
