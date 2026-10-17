from __future__ import annotations

import logging
from importlib import import_module

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse


schemas = import_module("backend.modules.signal-fusion.models.schemas")
triage_service = import_module("backend.modules.signal-fusion.services.triage_service")
engine_module = import_module("backend.modules.signal-fusion.services.fusion_engine")
place_module = import_module("backend.modules.live-dispatch.services.mock_call_service")
logger = logging.getLogger(__name__)
engine = engine_module.engine
InvalidTransition = engine_module.InvalidTransition
RiskExpired = engine_module.RiskExpired
InvalidRiskValidity = engine_module.InvalidRiskValidity
StorageUnavailable = engine_module.StorageUnavailable

router = APIRouter()


def model_payload(model) -> dict:
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def storage_error(exc: StorageUnavailable) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "signal_fusion_storage_unavailable",
            "message": str(exc),
            "recovery": "Start anwar-postgres with: docker compose up -d anwar-postgres",
        },
    )


def operator_id(x_operator_id: str) -> str:
    actor = x_operator_id.strip()
    if not actor or len(actor) > 120:
        raise HTTPException(422, "X-Operator-ID must contain 1 to 120 non-whitespace characters")
    return actor


async def attach_dispatch_preview(result: dict) -> dict:
    summary = result["summary"]
    try:
        preview = await place_module.preview_triage_summary(summary)
    except Exception:
        logger.exception("Could not plan a route for triaged call %s", summary["call_id"])
        classification = {"emergency": "legit_distress", "spam": "scam", "silent": "misc"}[summary["call_class"]]
        preview = {"call_id": summary["call_id"], "classification": classification,
                   "routable": False, "reason": "Route preview unavailable; check local OSRM."}
    result["dispatch_preview"] = place_module.publish_ingestion_preview(preview)
    return result


@router.get("/health")
async def health():
    return {"engine": "signal-fusion", "mode": "realtime", **engine.health()}


@router.get("/contract")
async def contract():
    return {
        "module": "signal-fusion",
        "contract_version": "1.1",
        "ingestion_endpoint": "/api/signal-fusion/ingest",
        "supported_sources": [
            "WEATHER", "TRAFFIC", "CCTV", "CALL", "FIELD", "RADIO", "SMS", "APP"
        ],
        "matching_policy": {
            "incident_radius_km": 1.5,
            "risk_radius_km": 3.0,
            "incident_window_minutes": 15,
            "preserve_raw_evidence": True,
            "automatic_dispatch": False,
        },
        "incident_feed": "/api/signal-fusion/incidents",
        "event_feed": "/api/signal-fusion/events?after={cursor}",
        "event_types": [
            "signal_fusion.incident.promoted.v1",
            "signal_fusion.incident.updated.v1",
            "signal_fusion.risk.assessed.v1",
            "signal_fusion.risk.level_changed.v1",
            "signal_fusion.risk.acknowledged.v1",
        ],
        "downstream_owner": "command-center",
    }


@router.get("/snapshot", response_model=schemas.Snapshot)
async def snapshot():
    try:
        return engine.snapshot()
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/signals", response_model=list[schemas.Signal])
async def signals():
    try:
        return engine.snapshot()["signals"]
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/triage/capabilities")
async def triage_capabilities():
    return {
        "speech_to_text": "DGX Spark Omni",
        "model": triage_service.STT_MODEL,
        "configured": True,
        "supported_extensions": sorted(triage_service.ALLOWED_AUDIO_EXTENSIONS),
        "max_audio_bytes": triage_service.MAX_AUDIO_BYTES,
        "preserves_audio_evidence": True,
        "automatic_dispatch": False,
    }


@router.get("/audio/{audio_id}")
async def call_audio(audio_id: str):
    path = triage_service.resolve_audio(audio_id)
    if path is None:
        raise HTTPException(404, "call audio not found")
    return FileResponse(
        path,
        media_type=None,
        filename=path.name,
        content_disposition_type="inline",
    )


@router.post("/ingest", response_model=schemas.IngestionResult, status_code=201)
async def ingest_report(payload: schemas.SignalIn):
    try:
        return engine.ingest_report(model_payload(payload))
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/triage/samples")
async def triage_samples():
    return [{"name": name, "url": f"/api/signal-fusion/triage/samples/{name}"} for name in triage_service.list_samples()]


@router.get("/triage/samples/{name}")
async def triage_sample_audio(name: str):
    path = triage_service.resolve_sample(name)
    if path is None:
        raise HTTPException(404, "voice sample not found")
    return FileResponse(path, media_type="audio/mpeg", content_disposition_type="inline")


@router.post("/triage", response_model=schemas.TriageResult, status_code=201)
async def triage_call(payload: schemas.TriageRequest):
    """Live call triage: recording -> transcript -> decision tree -> summary; emergencies also enter fusion."""
    transcript = payload.transcript
    audio_url = None
    try:
        if payload.sample:
            transcript = await run_in_threadpool(triage_service.transcribe_sample, payload.sample)
            audio_url = f"/api/signal-fusion/triage/samples/{payload.sample}"
        elif transcript is None and payload.audio_base64:
            transcript = await run_in_threadpool(
                triage_service.transcribe_audio, payload.audio_base64, payload.audio_filename
            )
            evidence = await run_in_threadpool(
                triage_service.store_audio, payload.audio_base64, payload.audio_filename
            )
            audio_url = evidence["url"]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"transcription failed: {exc}") from exc
    if transcript is None:
        raise HTTPException(422, "provide sample, audio_base64, or transcript")

    decision, extraction, provider = await run_in_threadpool(triage_service.run_tree, transcript)
    summary = {**triage_service.build_summary(transcript, decision, extraction), "audio_url": audio_url}
    # triage_provider tells the UI whether the DGX LLM answered or the keyword fallback ran.
    result = {"summary": summary, "path": [step.model_dump() for step in decision.path], "triage_provider": provider}
    if decision.call_class != "emergency":
        # Silent and spam calls stop here; nothing enters fusion.
        return await attach_dispatch_preview(result)

    location = summary["location"]
    if payload.latitude is not None:
        location.update(lat=payload.latitude, lng=payload.longitude)
        if not location["text"]:
            location["text"] = "Caller-provided coordinates"
    elif location["lat"] is None and location["text"]:
        try:
            place = place_module.resolve_place(location["text"])
        except place_module.PlaceNotFound:
            pass
        else:
            location.update(lat=place["coordinate"][1], lng=place["coordinate"][0])
    if location["lat"] is None or location["lng"] is None:
        # Do not create a dispatchable incident at a guessed city-centre coordinate.
        if "location" not in summary["missing"]:
            summary["missing"].append("location")
        return await attach_dispatch_preview(result)
    summary["missing"] = [item for item in summary["missing"] if item != "location"]
    signal = schemas.SignalIn(
        source="CALL",
        external_id=summary["call_id"],
        caller=payload.caller,
        transcript=transcript,
        location=location["text"],
        latitude=location["lat"],
        longitude=location["lng"],
        severity={"P1": 95, "P2": 80, "P3": 65}[decision.priority],
        metadata={
            "call_id": summary["call_id"],
            "triage_priority": decision.priority,
            "triage_rationale": extraction.rationale,
            "triage_confidence": round(extraction.confidence, 2),
            "triage_provider": provider,
            "patient_count": extraction.patient_count,
            "missing_fields": ",".join(decision.missing_fields),
            "audio_url": audio_url or "",
        },
    )
    try:
        result["ingestion"] = engine.ingest_report(model_payload(signal))
    except StorageUnavailable as exc:
        result["ingestion_error"] = str(exc)
    return await attach_dispatch_preview(result)


@router.post("/signals", response_model=schemas.Signal, status_code=201)
async def ingest_legacy(payload: schemas.SignalIn):
    """Backward-compatible endpoint for existing channel adapters."""
    try:
        return engine.ingest(model_payload(payload))
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.post("/risk-signals", response_model=schemas.RiskIngestionResult, status_code=201)
async def ingest_risk_signal(payload: schemas.RiskSignalIn):
    try:
        return engine.ingest_risk_signal(model_payload(payload))
    except InvalidRiskValidity as exc:
        raise HTTPException(422, str(exc)) from exc
    except RiskExpired as exc:
        raise HTTPException(409, str(exc)) from exc
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/risks", response_model=list[schemas.RiskAssessment])
async def risks():
    try:
        return engine.list_risks()
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.post("/risks/{risk_id}/acknowledge", response_model=schemas.RiskAssessment)
async def acknowledge_risk(
    risk_id: str,
    x_operator_id: str = Header(default="console-operator"),
):
    try:
        return engine.acknowledge_risk(risk_id, operator_id(x_operator_id))
    except KeyError:
        raise HTTPException(404, "risk assessment not found") from None
    except RiskExpired as exc:
        raise HTTPException(409, str(exc)) from exc
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/clusters", response_model=list[schemas.Cluster])
async def clusters():
    try:
        return engine.snapshot()["clusters"]
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.post(
    "/clusters/{cluster_id}/promote-to-incident",
    response_model=schemas.PromotionResult,
)
async def promote_to_incident(
    cluster_id: str,
    x_operator_id: str = Header(default="console-operator"),
):
    try:
        return engine.promote(cluster_id, x_operator_id)
    except KeyError:
        raise HTTPException(404, "cluster not found") from None
    except InvalidTransition as exc:
        raise HTTPException(409, str(exc)) from exc
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.post("/clusters/{cluster_id}/override", response_model=schemas.Cluster)
async def override_cluster_recommendation(
    cluster_id: str,
    payload: schemas.OverrideRequest,
    x_operator_id: str = Header(default="console-operator"),
):
    try:
        return engine.override_recommendation(
            cluster_id,
            payload.recommended_action,
            payload.reason,
            operator_id(x_operator_id),
        )
    except KeyError:
        raise HTTPException(404, "cluster not found") from None
    except InvalidTransition as exc:
        raise HTTPException(409, str(exc)) from exc
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.post("/clusters/{cluster_id}/split")
async def split_cluster(
    cluster_id: str,
    payload: schemas.SplitRequest,
    x_operator_id: str = Header(default="console-operator"),
):
    try:
        return engine.split(
            cluster_id,
            payload.signal_ids,
            payload.reason,
            operator_id(x_operator_id),
        )
    except KeyError:
        raise HTTPException(404, "cluster or signal not found") from None
    except InvalidTransition as exc:
        raise HTTPException(409, str(exc)) from exc
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.post("/clusters/{cluster_id}/{action}", response_model=schemas.Cluster)
async def cluster_action(
    cluster_id: str,
    action: str,
    x_operator_id: str = Header(default="console-operator"),
):
    if action not in {"verify", "promote", "dismiss"}:
        raise HTTPException(400, "action must be verify, promote, or dismiss")
    try:
        return engine.action(cluster_id, action, x_operator_id)
    except KeyError:
        raise HTTPException(404, "cluster not found") from None
    except InvalidTransition as exc:
        raise HTTPException(409, str(exc)) from exc
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.post("/clusters/merge", response_model=schemas.Cluster)
async def merge(
    payload: schemas.MergeRequest,
    x_operator_id: str = Header(default="console-operator"),
):
    try:
        return engine.merge(
            payload.source_cluster_id,
            payload.target_cluster_id,
            x_operator_id,
        )
    except KeyError:
        raise HTTPException(404, "one or both clusters were not found") from None
    except InvalidTransition as exc:
        raise HTTPException(409, str(exc)) from exc
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/incidents", response_model=list[schemas.IncidentHandoff])
async def incidents():
    try:
        return engine.list_incidents()
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/incidents/{incident_id}", response_model=schemas.IncidentHandoff)
async def incident(incident_id: str):
    try:
        return engine.get_incident(incident_id)
    except KeyError:
        raise HTTPException(404, "incident handoff not found") from None
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/events", response_model=schemas.EventFeed)
async def events(
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    try:
        return engine.events(after, limit)
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc


@router.get("/audit", response_model=list[schemas.AuditEvent])
async def audit(limit: int = Query(default=100, ge=1, le=500)):
    try:
        return engine.audit(limit)
    except StorageUnavailable as exc:
        raise storage_error(exc) from exc
