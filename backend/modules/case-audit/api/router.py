from __future__ import annotations

from importlib import import_module

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool


schemas = import_module("backend.modules.case-audit.models.schemas")
service = import_module("backend.modules.case-audit.services.audit_service")

router = APIRouter()


@router.get("/health")
async def health():
    return {"module": "case-audit", "provider": "dgx-spark-vllm", "model": service.AUDIT_MODEL}


@router.post("/chat", response_model=schemas.AuditChatResponse)
async def chat(payload: schemas.AuditChatRequest):
    try:
        return await run_in_threadpool(service.answer, payload)
    except service.AuditUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
