from __future__ import annotations

from importlib import import_module

from fastapi import APIRouter, Header, HTTPException, Query

schemas = import_module("backend.modules.live-dispatch.models.schemas")
service_module = import_module("backend.modules.live-dispatch.services.routing_service")
routing_service = service_module.routing_service
RoutingUnavailable = service_module.RoutingUnavailable
dispatch_module = import_module("backend.modules.live-dispatch.services.dispatch_service")
dispatch_service = dispatch_module.dispatch_service

router = APIRouter()


@router.get("/health")
async def health():
    return {**await dispatch_service.health(), "provider": "local-osrm", "source": "malaysia-singapore-brunei-260712.osm.pbf"}


@router.post("/route", response_model=schemas.RouteResult)
async def route(payload: schemas.RouteRequest):
    try:
        return await routing_service.route(payload.coordinates)
    except RoutingUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/snapshot", response_model=schemas.DispatchSnapshot)
async def snapshot():
    try:
        return await dispatch_service.snapshot()
    except Exception as exc:
        raise dispatch_error(exc) from exc


def model_payload(model):
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def dispatch_error(exc):
    if isinstance(exc, (dispatch_module.DispatchNotFound, dispatch_module.UnitNotFound, KeyError)):
        return HTTPException(404, str(exc))
    if isinstance(exc, (dispatch_module.InvalidDispatchTransition, dispatch_module.NoEligibleUnit, dispatch_module.DispatchConflict)):
        return HTTPException(409, {"code": exc.__class__.__name__, "message": str(exc)})
    if isinstance(exc, dispatch_module.CommandCenterUnavailable):
        return HTTPException(503, {"code": "command_center_unavailable", "message": str(exc)})
    if isinstance(exc, dispatch_module.DispatchStorageUnavailable):
        return HTTPException(503, {"code": "dispatch_storage_unavailable", "message": str(exc)})
    if isinstance(exc, RoutingUnavailable):
        return HTTPException(503, {"code": "routing_unavailable", "message": str(exc)})
    return HTTPException(500, {"code": "dispatch_error", "message": str(exc)})


@router.post("/optimize", response_model=list[schemas.DispatchRecommendation])
async def optimize_all():
    try:
        return await dispatch_service.optimize_all()
    except Exception as exc:
        raise dispatch_error(exc) from exc


@router.get("/units", response_model=list[schemas.DispatchUnit])
async def units():
    try: return dispatch_service.units()
    except Exception as exc: raise dispatch_error(exc) from exc


@router.patch("/units/{unit_id}/location")
async def update_unit_location(unit_id: str, request: schemas.UnitLocationUpdate):
    try: return await dispatch_service.update_unit_location(unit_id, model_payload(request))
    except Exception as exc: raise dispatch_error(exc) from exc


@router.get("/facilities", response_model=list[schemas.Facility])
async def facilities():
    try: return dispatch_service.facilities()
    except Exception as exc: raise dispatch_error(exc) from exc


@router.patch("/facilities/{facility_id}", response_model=schemas.Facility)
async def update_facility(facility_id: str, request: schemas.FacilityUpdate):
    try: return dispatch_service.update_facility(facility_id, model_payload(request))
    except Exception as exc: raise dispatch_error(exc) from exc


@router.get("/incidents/{incident_id}/care-options", response_model=schemas.CareOptionsResponse)
async def care_options(incident_id: str):
    try: return await dispatch_service.care_options(incident_id)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.get("/dispatches", response_model=list[schemas.DispatchRecommendation])
async def dispatches(include_closed: bool = Query(default=False)):
    try: return dispatch_service.dispatches(include_closed)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/accept", response_model=schemas.DispatchRecommendation)
async def accept(dispatch_id: str, request: schemas.DecisionRequest, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.accept(dispatch_id, request.expected_version, x_operator_id, request.note)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/reject")
async def reject(dispatch_id: str, request: schemas.RejectRequest, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.reject(dispatch_id, request.expected_version, x_operator_id, request.reason, request.reoptimize)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/reassign", response_model=schemas.DispatchRecommendation)
async def reassign(dispatch_id: str, request: schemas.ReassignRequest, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.reassign(dispatch_id, request.unit_id, request.expected_version, x_operator_id, request.reason)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/backup", response_model=schemas.DispatchRecommendation)
async def backup(dispatch_id: str, request: schemas.BackupRequest, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.request_backup(dispatch_id, request.capability, x_operator_id, request.reason)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/transition", response_model=schemas.DispatchRecommendation)
async def transition(dispatch_id: str, request: schemas.DispatchTransitionRequest, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.transition(dispatch_id, request.status, request.expected_version, x_operator_id, request.note)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/cancel", response_model=schemas.DispatchRecommendation)
async def cancel(dispatch_id: str, request: schemas.DecisionRequest, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.cancel(dispatch_id, request.expected_version, x_operator_id, request.note)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/reroute", response_model=schemas.RerouteResponse)
async def reroute(dispatch_id: str, request: schemas.RerouteRequest, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.reroute(dispatch_id, model_payload(request), x_operator_id)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.post("/dispatches/{dispatch_id}/pre-alert-draft", response_model=schemas.PreAlertDraftResponse)
async def pre_alert_draft(dispatch_id: str, x_operator_id: str = Header(default="dispatch-operator")):
    try: return await dispatch_service.pre_alert_draft(dispatch_id, x_operator_id)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.get("/dispatches/{dispatch_id}/audit")
async def audit(dispatch_id: str, limit: int = Query(default=100, ge=1, le=500)):
    try: return dispatch_service.audit(dispatch_id, limit)
    except Exception as exc: raise dispatch_error(exc) from exc


@router.get("/events", response_model=schemas.DispatchEventFeed)
async def events(after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=500)):
    try: return dispatch_service.events(after, limit)
    except Exception as exc: raise dispatch_error(exc) from exc
