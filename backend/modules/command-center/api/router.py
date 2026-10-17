from __future__ import annotations

from importlib import import_module

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool


schemas = import_module("backend.modules.command-center.models.schemas")
service_module = import_module("backend.modules.command-center.services.command_service")
service = service_module.service
StorageUnavailable = service_module.StorageUnavailable
SourceUnavailable = service_module.SourceUnavailable
InvalidTransition = service_module.InvalidTransition
IncidentNotFound = service_module.IncidentNotFound
ConcurrencyConflict = service_module.ConcurrencyConflict

router = APIRouter()


def payload(model) -> dict:
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def operator_error(exc: Exception) -> HTTPException:
    if isinstance(exc, IncidentNotFound):
        return HTTPException(404, "incident not found")
    if isinstance(exc, InvalidTransition):
        return HTTPException(409, {"code": "invalid_transition", "message": str(exc)})
    if isinstance(exc, ConcurrencyConflict):
        return HTTPException(409, {"code": "version_conflict", "message": str(exc), "recovery": "Refresh the incident and retry"})
    if isinstance(exc, StorageUnavailable):
        return HTTPException(503, {"code": "command_center_storage_unavailable", "message": str(exc), "recovery": "Start anwar-postgres with: docker compose up -d anwar-postgres"})
    return HTTPException(500, "unexpected Command Center error")


@router.get("/health")
async def health():
    result = await run_in_threadpool(service.health)
    return {"module": "command-center", **result}


@router.get("/contract")
async def contract():
    return {
        "module": "command-center",
        "contract_version": "1.0",
        "source": "/api/signal-fusion/events",
        "snapshot": "/api/command-center/snapshot",
        "incident_feed": "/api/command-center/incidents",
        "dispatch_event_feed": "/api/command-center/events?after={cursor}",
        "event_types": [
            "command_center.incident.created.v1",
            "command_center.incident.updated.v1",
            "command_center.incident.assigned.v1",
            "command_center.incident.status_{status}.v1",
            "command_center.incident.priority_overridden.v1",
        ],
        "downstream_owners": ["live-dispatch", "care-route-optimizer", "dispatch-assistant"],
    }


@router.post("/sync", response_model=schemas.SyncResult)
async def sync(limit: int = Query(default=100, ge=1, le=500)):
    try:
        return await run_in_threadpool(service.sync, limit)
    except SourceUnavailable as exc:
        raise HTTPException(503, {"code": "signal_fusion_unavailable", "message": str(exc)}) from exc
    except StorageUnavailable as exc:
        raise operator_error(exc) from exc


@router.get("/snapshot", response_model=schemas.Snapshot)
async def snapshot(sync_source: bool = Query(default=True)):
    try:
        return await run_in_threadpool(lambda: service.snapshot(sync=sync_source))
    except StorageUnavailable as exc:
        raise operator_error(exc) from exc


@router.get("/incidents", response_model=list[schemas.Incident])
async def incidents(include_closed: bool = Query(default=False)):
    try:
        return await run_in_threadpool(lambda: service.list_incidents(include_closed=include_closed))
    except StorageUnavailable as exc:
        raise operator_error(exc) from exc


@router.get("/incidents/{incident_id}", response_model=schemas.Incident)
async def incident(incident_id: str):
    try:
        return await run_in_threadpool(service.get_incident, incident_id)
    except (IncidentNotFound, StorageUnavailable) as exc:
        raise operator_error(exc) from exc


@router.post("/incidents/{incident_id}/acknowledge", response_model=schemas.Incident)
async def acknowledge(incident_id: str, request: schemas.AcknowledgeRequest, x_operator_id: str = Header(default="console-operator")):
    try:
        return await run_in_threadpool(lambda: service.acknowledge(incident_id, actor=x_operator_id, note=request.note, expected_version=request.expected_version))
    except (IncidentNotFound, InvalidTransition, ConcurrencyConflict, StorageUnavailable) as exc:
        raise operator_error(exc) from exc


@router.post("/incidents/{incident_id}/transition", response_model=schemas.Incident)
async def transition(incident_id: str, request: schemas.TransitionRequest, x_operator_id: str = Header(default="console-operator")):
    try:
        return await run_in_threadpool(lambda: service.transition(incident_id, request.status, actor=x_operator_id, note=request.note, expected_version=request.expected_version))
    except (IncidentNotFound, InvalidTransition, ConcurrencyConflict, StorageUnavailable) as exc:
        raise operator_error(exc) from exc


@router.post("/incidents/{incident_id}/assign", response_model=schemas.Incident)
async def assign(incident_id: str, request: schemas.AssignmentRequest, x_operator_id: str = Header(default="console-operator")):
    try:
        return await run_in_threadpool(lambda: service.assign(incident_id, payload(request), actor=x_operator_id))
    except (IncidentNotFound, InvalidTransition, ConcurrencyConflict, StorageUnavailable) as exc:
        raise operator_error(exc) from exc


@router.post("/incidents/{incident_id}/priority", response_model=schemas.Incident)
async def priority(incident_id: str, request: schemas.PriorityRequest, x_operator_id: str = Header(default="console-operator")):
    try:
        return await run_in_threadpool(lambda: service.override_priority(incident_id, request.priority, reason=request.reason, actor=x_operator_id, expected_version=request.expected_version))
    except (IncidentNotFound, InvalidTransition, ConcurrencyConflict, StorageUnavailable) as exc:
        raise operator_error(exc) from exc


@router.get("/incidents/{incident_id}/assignments", response_model=list[schemas.Assignment])
async def assignments(incident_id: str):
    try:
        return await run_in_threadpool(service.assignments, incident_id)
    except (IncidentNotFound, StorageUnavailable) as exc:
        raise operator_error(exc) from exc


@router.get("/incidents/{incident_id}/timeline", response_model=list[schemas.AuditEvent])
async def timeline(incident_id: str, limit: int = Query(default=100, ge=1, le=500)):
    try:
        return await run_in_threadpool(service.audit, incident_id, limit)
    except (IncidentNotFound, StorageUnavailable) as exc:
        raise operator_error(exc) from exc


@router.get("/audit", response_model=list[schemas.AuditEvent])
async def audit(limit: int = Query(default=100, ge=1, le=500)):
    try:
        return await run_in_threadpool(service.audit, None, limit)
    except StorageUnavailable as exc:
        raise operator_error(exc) from exc


@router.get("/events", response_model=schemas.EventFeed)
async def events(after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=500)):
    try:
        return await run_in_threadpool(service.events, after, limit)
    except StorageUnavailable as exc:
        raise operator_error(exc) from exc
