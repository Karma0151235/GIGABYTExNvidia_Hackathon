from __future__ import annotations

from importlib import import_module

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool


schemas = import_module("backend.modules.field-clinical-report.models.schemas")
report_module = import_module("backend.modules.field-clinical-report.services.report_service")

router = APIRouter()


@router.get("/health")
async def health():
    return report_module.health()


@router.post("/reports/draft", response_model=schemas.DraftReport)
async def draft_report(payload: schemas.ReportRequest):
    try:
        return await run_in_threadpool(report_module.generate_draft, payload)
    except (report_module.InvalidImage, report_module.InvalidVideo) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except report_module.VLMUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except report_module.VLMRejected as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except report_module.InvalidVLMResponse as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
