"""Fixed, read-only operational views for Dispatch Copilot.

The model never writes or generates SQL. It receives the result of one of these
server-owned query plans and may only explain the returned rows.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any


ACTIVE_DISPATCH = {"recommended", "accepted", "en_route", "on_scene", "transporting"}


def execute(
    question: str,
    context: dict[str, Any],
    incident_id: str | None = None,
    previous_query_id: str | None = None,
) -> dict[str, Any]:
    query_id = choose_query(question, previous_query_id)
    focus_id = _focus_incident(question, incident_id, context.get("incidents", []))
    handlers = {
        "capability_help": _capability_help,
        "unsupported": _unsupported,
        "operational_overview": _operational_overview,
        "attention_queue": _attention_queue,
        "unit_ranking": _unit_ranking,
        "facility_capacity": _facility_capacity,
        "route_status": _route_status,
        "oracle_watch": _oracle_watch,
    }
    result = handlers[query_id](context, focus_id)
    result["query"] = {
        "id": query_id,
        "label": result.pop("query_label"),
        "mode": "static_read_model",
        "focus_incident_id": focus_id,
        "row_count": sum(len(item.get("rows", [])) for item in result["artifacts"]),
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "data_sources": result.pop("data_sources"),
    }
    result["limitations"] = [*context.get("limitations", []), *result.get("limitations", [])]
    return result


def choose_query(question: str, previous_query_id: str | None = None) -> str:
    text = " ".join(question.lower().strip().split())
    if re.match(r"^(hi|hello|hey|good morning|good afternoon|good evening|salam|hai)\b", text) or any(
        phrase in text for phrase in ("what can you do", "how can you help", "help me use", "show me your capabilities")
    ):
        return "capability_help"
    if any(word in text for word in ("oracle", "risk zone", "rain", "congestion", "early warning")):
        return "oracle_watch"
    if any(word in text for word in ("hospital", "facility", "destination", "capacity", "ed load")):
        return "facility_capacity"
    if any(word in text for word in ("route", "eta", "distance", "path", "travel")):
        return "route_status"
    if any(word in text for word in ("rank", "unit", "ambulance", "why was", "why is", "recommend")):
        return "unit_ranking"
    if any(word in text for word in ("unassigned", "attention", "urgent", "operator action", "needs action", "sla")):
        return "attention_queue"
    if previous_query_id in {
        "operational_overview", "attention_queue", "unit_ranking",
        "facility_capacity", "route_status", "oracle_watch",
    } and (len(text.split()) <= 7 or any(word in text for word in ("those", "that", "second", "compare", "why"))):
        return previous_query_id
    if any(word in text for word in ("incident", "emergency", "dispatch", "fleet", "crew", "coverage", "command", "active", "readiness", "status")):
        return "operational_overview"
    return "unsupported"


def _capability_help(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    return {
        "query_label": "Copilot capability guide",
        "data_sources": ["dispatch_assistant.capability_catalog"],
        "answer": "Hello. I am ANWAR Dispatch Copilot. I can inspect the live command picture, rank ambulances, compare hospitals, explain road ETAs, and summarize predictive risks.",
        "rationale": "Ask an operational question or choose a prepared command from the demo deck. I use fixed read-only views and cannot execute dispatch actions.",
        "confidence": 1.0,
        "recommended_unit_id": None,
        "recommended_facility_id": None,
        "sources": ["dispatch-assistant:capability-catalog"],
        "suggested_actions": ["Open Command Center", "Open Live Dispatch", "Open Triage Queue"],
        "limitations": ["Dispatch Copilot is limited to ANWAR emergency operations data and workflow guidance."],
        "artifacts": [_metrics("Available capabilities", [
            ("Command picture", "Live", "Incident readiness and SLA review", "blue"),
            ("Unit ranking", "OSRM", "ETA and capability comparison", "cyan"),
            ("Care capacity", "Live", "Hospital acceptance and ED load", "green"),
            ("Oracle Watch", "Predictive", "Risk zones and lead time", "amber"),
        ])],
    }


def _unsupported(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    return {
        "query_label": "Out-of-scope request",
        "data_sources": ["dispatch_assistant.scope_policy"],
        "answer": "That request is outside Dispatch Copilot's operational scope.",
        "rationale": "I can help with ANWAR incidents, ambulance rankings, hospital capacity, route ETAs, fleet coverage, and Oracle risks. I will not invent an answer from unrelated data.",
        "confidence": 1.0,
        "recommended_unit_id": None,
        "recommended_facility_id": None,
        "sources": ["dispatch-assistant:scope-policy"],
        "suggested_actions": ["Open Command Center", "Open Live Dispatch"],
        "limitations": ["No external web, general knowledge, clinical prescribing, or non-operational data source was queried."],
        "artifacts": [],
    }


def _operational_overview(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    incidents = [item for item in context.get("incidents", []) if item.get("status") not in {"resolved", "cancelled"}]
    dispatches = _dispatch_map(context)
    available = [unit for unit in context.get("units", []) if unit.get("status") == "available"]
    critical = [item for item in incidents if item.get("priority") == "P1"]
    rows = [_incident_row(item, dispatches.get(item["id"])) for item in _priority_sort(incidents)]
    return {
        "query_label": "Current operational readiness",
        "data_sources": ["command_center.incidents", "live_dispatch.dispatches", "live_dispatch.units"],
        "answer": f"{len(incidents)} active incidents are in the command picture. {len(dispatches)} have an active dispatch decision and {len(available)} units remain available.",
        "rationale": "The overview joins active Command Center incidents to current dispatch recommendations and live unit availability.",
        "confidence": 0.99,
        "recommended_unit_id": None,
        "recommended_facility_id": None,
        "sources": ["command-center:snapshot", "live-dispatch:snapshot"],
        "suggested_actions": ["Review incidents requiring operator action", "Open Live Dispatch"],
        "limitations": [],
        "artifacts": [
            _metrics("Operational posture", [
                ("Active incidents", len(incidents), "Current command picture", "blue"),
                ("P1 critical", len(critical), "Highest clinical priority", "red"),
                ("Dispatch decisions", len(dispatches), "Recommended or active", "cyan"),
                ("Units available", len(available), "Ready for allocation", "green"),
            ]),
            _table("Incident readiness", "Live Command Center incidents joined to dispatch decisions", _incident_columns(), rows),
        ],
    }


def _attention_queue(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    dispatches = _dispatch_map(context)
    incidents = [
        item for item in context.get("incidents", [])
        if item.get("status") not in {"resolved", "cancelled"}
        and (item.get("priority") in {"P1", "P2"} or item.get("sla_status") in {"breached", "at_risk"} or not item.get("assigned_unit_id"))
    ]
    rows = [_incident_row(item, dispatches.get(item["id"])) for item in _priority_sort(incidents)]
    no_decision = sum(item["dispatch_state"] == "Awaiting optimization" for item in rows)
    return {
        "query_label": "Operator attention queue",
        "data_sources": ["command_center.incidents", "live_dispatch.dispatches"],
        "answer": f"{len(rows)} incidents currently meet the operator-attention filter. {no_decision} have no active dispatch decision.",
        "rationale": "The fixed view prioritizes P1/P2 incidents, SLA risk, and incidents without a confirmed assignment.",
        "confidence": 0.99,
        "recommended_unit_id": None,
        "recommended_facility_id": None,
        "sources": ["command-center:incidents", "live-dispatch:dispatches"],
        "suggested_actions": ["Open Command Center incident queue", "Review pending dispatch recommendations"],
        "limitations": [],
        "artifacts": [
            _metrics("Attention summary", [
                ("Needs review", len(rows), "Priority or SLA filter", "amber"),
                ("No decision", no_decision, "Optimization not available", "red" if no_decision else "green"),
                ("P1 incidents", sum(row["priority"] == "P1" for row in rows), "Immediate priority", "red"),
            ]),
            _table("Priority queue", "Sorted by priority, SLA state, and severity", _incident_columns(), rows),
        ],
    }


def _unit_ranking(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    dispatch = _dispatch_map(context).get(focus_id)
    if not dispatch:
        return _empty_focus("Ambulance ranking", focus_id, "No active dispatch recommendation is available for this incident.")
    units = {item["id"]: item for item in context.get("units", [])}
    candidates = [item for item in dispatch.get("alternatives", []) if item.get("eligible")]
    candidates.sort(key=lambda item: (-float(item.get("score", 0)), float(item.get("eta_minutes") or 999)))
    rows = []
    for index, item in enumerate(candidates[:8], 1):
        unit = units.get(item["unit_id"], {})
        rows.append({
            "rank": index,
            "unit": item["unit_id"],
            "status": unit.get("status", "unknown").replace("_", " ").title(),
            "eta_minutes": round(float(item.get("eta_minutes") or 0), 1),
            "distance_km": round(float(item.get("distance_km") or 0), 1),
            "capability_match": round(float(item.get("capability_score", 0)) * 100),
            "score": round(float(item.get("score", 0)) * 100),
        })
    return {
        "query_label": "Ranked ambulance candidates",
        "data_sources": ["live_dispatch.dispatches", "live_dispatch.units", "local_osrm.routes"],
        "answer": f"{dispatch['unit_id']} is the current recommendation for {focus_id} with a {dispatch['scene_eta_minutes']:.1f}-minute road ETA.",
        "rationale": dispatch.get("decision_reason", "The unit leads the fixed dispatch scoring model."),
        "confidence": min(0.99, max(0.5, float(dispatch.get("optimization_score", 0)))),
        "recommended_unit_id": dispatch["unit_id"],
        "recommended_facility_id": dispatch.get("receiving_facility_id"),
        "sources": [f"live-dispatch:dispatches/{dispatch['id']}", f"command-center:incidents/{focus_id}"],
        "suggested_actions": ["Review and approve in Live Dispatch", "Inspect route and destination"],
        "limitations": [],
        "artifacts": [
            {
                "id": "dispatch-decision",
                "type": "recommendation",
                "title": f"Recommended response for {focus_id}",
                "subtitle": "Operator approval required",
                "metrics": [
                    {"label": "Recommended unit", "value": dispatch["unit_id"], "detail": dispatch.get("status", "").replace("_", " ").title(), "tone": "blue"},
                    {"label": "Road ETA", "value": f"{float(dispatch.get('scene_eta_minutes', 0)):.1f} min", "detail": f"{float(dispatch.get('scene_distance_km', 0)):.1f} km to scene", "tone": "cyan"},
                    {"label": "Decision score", "value": f"{float(dispatch.get('optimization_score', 0)) * 100:.0f}", "detail": dispatch.get("algorithm_version", "dispatch model"), "tone": "green"},
                    {"label": "Destination", "value": dispatch.get("receiving_facility_id") or "Not selected", "detail": "Receiving facility", "tone": "slate"},
                ],
                "columns": [],
                "rows": [],
            },
            _table("Candidate ranking", "Only eligible, road-routed units are shown", [
                _column("rank", "#", "number"), _column("unit", "Unit"), _column("status", "Status"),
                _column("eta_minutes", "ETA", "minutes"), _column("distance_km", "Distance", "distance"),
                _column("capability_match", "Capability", "percent"), _column("score", "Score", "score"),
            ], rows),
        ],
    }


def _facility_capacity(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    dispatch = _dispatch_map(context).get(focus_id)
    facilities = [
        item for item in context.get("facilities", [])
        if item.get("facility_type") == "hospital"
    ]
    facilities.sort(key=lambda item: (not item.get("accepting_patients", False), item.get("ed_load_percent", 101)))
    rows = [{
        "facility": item["name"],
        "facility_id": item["id"],
        "selected": bool(dispatch and dispatch.get("receiving_facility_id") == item["id"]),
        "accepting": bool(item.get("accepting_patients")),
        "ed_load": int(item.get("ed_load_percent", 0)),
        "ambulance_bays": int(item.get("ambulance_bays", 0)),
        "capabilities": ", ".join(item.get("capabilities", [])),
    } for item in facilities]
    selected = next((item for item in facilities if dispatch and dispatch.get("receiving_facility_id") == item["id"]), None)
    return {
        "query_label": "Receiving facility comparison",
        "data_sources": ["live_dispatch.facilities", "live_dispatch.dispatches"],
        "answer": f"{selected['name']} is the selected destination for {focus_id}." if selected else f"No destination is currently selected for {focus_id or 'the active incident'}.",
        "rationale": "Facilities are ordered by accepting status and current ED load; capability suitability remains mandatory for operator review.",
        "confidence": 0.96,
        "recommended_unit_id": dispatch.get("unit_id") if dispatch else None,
        "recommended_facility_id": selected["id"] if selected else None,
        "sources": ["live-dispatch:facilities", *( [f"live-dispatch:dispatches/{dispatch['id']}"] if dispatch else [])],
        "suggested_actions": ["Review destination in Care Routing", "Confirm hospital pre-alert"],
        "limitations": ["ED load is the latest local snapshot, not a national real-time bed registry."],
        "artifacts": [_table("Hospital capacity", "Selected destination and accepting alternatives", [
            _column("selected", "Selected", "boolean"), _column("facility", "Hospital"),
            _column("accepting", "Accepting", "boolean"), _column("ed_load", "ED load", "percent"),
            _column("ambulance_bays", "Bays", "number"), _column("capabilities", "Capabilities"),
        ], rows)],
    }


def _route_status(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    dispatches = list(_dispatch_map(context).values())
    if focus_id:
        dispatches = [item for item in dispatches if item.get("incident_id") == focus_id]
    rows = [{
        "incident": item["incident_id"], "unit": item["unit_id"],
        "state": item["status"].replace("_", " ").title(),
        "scene_eta": round(float(item.get("scene_eta_minutes") or 0), 1),
        "scene_distance": round(float(item.get("scene_distance_km") or 0), 1),
        "hospital_eta": round(float(item.get("hospital_eta_minutes") or 0), 1) if item.get("hospital_eta_minutes") is not None else None,
        "destination": item.get("receiving_facility_id") or "Pending",
    } for item in dispatches]
    return {
        "query_label": "Current route status",
        "data_sources": ["live_dispatch.dispatches", "local_osrm.routes"],
        "answer": f"{len(rows)} active road-routing decisions are available" + (f" for {focus_id}." if focus_id else "."),
        "rationale": "ETAs and distances come from the saved local OSRM route geometry, not straight-line estimates.",
        "confidence": 0.99 if rows else 0.5,
        "recommended_unit_id": rows[0]["unit"] if len(rows) == 1 else None,
        "recommended_facility_id": rows[0]["destination"] if len(rows) == 1 else None,
        "sources": ["live-dispatch:dispatches", "routing:local-osrm"],
        "suggested_actions": ["Open Live Dispatch map", "Review route before approval"],
        "limitations": ["No commercial live-traffic disruption feed is connected."],
        "artifacts": [_table("Road route legs", "Base to scene and scene to receiving facility", [
            _column("incident", "Incident"), _column("unit", "Unit"), _column("state", "State"),
            _column("scene_eta", "Scene ETA", "minutes"), _column("scene_distance", "Distance", "distance"),
            _column("hospital_eta", "Hospital ETA", "minutes"), _column("destination", "Destination"),
        ], rows)],
    }


def _oracle_watch(context: dict[str, Any], focus_id: str | None) -> dict[str, Any]:
    risks = context.get("risks", [])
    rows = [{
        "zone": item.get("zone"), "level": str(item.get("level", "")).title(),
        "confidence": int(item.get("confidence", 0)), "trend": str(item.get("confidence_trend", "stable")).title(),
        "evidence": len(item.get("evidence", [])), "action": str(item.get("recommended_action", "monitor")).replace("_", " ").title(),
        "lead_time": None, "linked_incident": item.get("linked_cluster_id") or "Pre-incident",
    } for item in risks]
    if not rows:
        predictive_clusters = [
            item for item in context.get("fusion", {}).get("clusters", [])
            if item.get("risk_zone_id") or {"WEATHER", "TRAFFIC"} & set(item.get("source_mix", {}))
        ]
        rows = [{
            "zone": item.get("location") or item.get("title"),
            "level": "Critical" if item.get("severity", 0) >= 90 else "High" if item.get("severity", 0) >= 70 else "Medium",
            "confidence": int(item.get("confidence", 0)),
            "trend": str(item.get("confidence_trend", "stable")).title(),
            "evidence": int(item.get("signal_count", 0)),
            "action": item.get("recommended_action") or "Review predictive evidence",
            "lead_time": item.get("lead_time_minutes"),
            "linked_incident": item.get("action_state") or item.get("status", "Linked").replace("_", " ").title(),
        } for item in predictive_clusters]
    active_text = f"{len(risks)} active zone{'s' if len(risks) != 1 else ''}" if risks else "No unexpired pre-incident zones"
    return {
        "query_label": "Oracle early-warning zones",
        "data_sources": ["signal_fusion.risk_assessments", "signal_fusion.signals"],
        "answer": f"{active_text}; {len(rows)} predictive cluster{'s remain' if len(rows) != 1 else ' remains'} in the operational picture.",
        "rationale": "Risk zones correlate independent weather, traffic, CCTV, call, and field evidence before operator promotion.",
        "confidence": 0.97,
        "recommended_unit_id": None,
        "recommended_facility_id": None,
        "sources": ["signal-fusion:risks", "signal-fusion:evidence"],
        "suggested_actions": ["Open Live Signals", "Review staged preparation"],
        "limitations": [],
        "artifacts": [_table("Predictive risk zones", "Active zones and incident-linked predictive history", [
            _column("level", "Risk"), _column("zone", "Zone"), _column("confidence", "Confidence", "percent"),
            _column("trend", "Trend"), _column("evidence", "Evidence", "number"),
            _column("lead_time", "Lead time", "minutes"), _column("action", "Recommended preparation"),
            _column("linked_incident", "Linked state"),
        ], rows)],
    }


def _dispatch_map(context: dict[str, Any]) -> dict[str, dict]:
    result = {}
    for item in context.get("dispatches", []):
        if item.get("status") not in ACTIVE_DISPATCH or item.get("is_backup"):
            continue
        current = result.get(item["incident_id"])
        if current is None or str(item.get("updated_at", "")) > str(current.get("updated_at", "")):
            result[item["incident_id"]] = item
    return result


def _focus_incident(question: str, incident_id: str | None, incidents: list[dict]) -> str | None:
    match = re.search(r"\bINC-[A-Z0-9-]+\b", question.upper())
    if match:
        return match.group(0)
    if incident_id:
        return incident_id
    active = _priority_sort([item for item in incidents if item.get("status") not in {"resolved", "cancelled"}])
    return active[0]["id"] if active else None


def _priority_sort(incidents: list[dict]) -> list[dict]:
    rank = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}
    return sorted(incidents, key=lambda item: (rank.get(item.get("priority"), 9), item.get("sla_seconds_remaining", 999999), -item.get("severity", 0)))


def _incident_row(incident: dict, dispatch: dict | None) -> dict:
    assignment = incident.get("assigned_unit_id")
    return {
        "priority": incident.get("priority"),
        "incident": incident.get("id"),
        "event": incident.get("title"),
        "location": incident.get("location"),
        "sla": str(incident.get("sla_status", "unknown")).replace("_", " ").title(),
        "dispatch_state": dispatch.get("status", "").replace("_", " ").title() if dispatch else "Awaiting optimization",
        "unit": assignment or (dispatch.get("unit_id") if dispatch else "Pending"),
        "eta_minutes": round(float(dispatch.get("scene_eta_minutes")), 1) if dispatch else None,
    }


def _incident_columns() -> list[dict]:
    return [
        _column("priority", "Priority", "priority"), _column("incident", "Incident"),
        _column("event", "Event"), _column("location", "Location"), _column("sla", "SLA"),
        _column("dispatch_state", "Dispatch state"), _column("unit", "Unit"),
        _column("eta_minutes", "Road ETA", "minutes"),
    ]


def _empty_focus(title: str, focus_id: str | None, message: str) -> dict[str, Any]:
    return {
        "query_label": title,
        "data_sources": ["command_center.incidents", "live_dispatch.dispatches"],
        "answer": message,
        "rationale": "The fixed operational view found no active matching record.",
        "confidence": 0.5,
        "recommended_unit_id": None,
        "recommended_facility_id": None,
        "sources": [f"command-center:incidents/{focus_id}" if focus_id else "command-center:snapshot"],
        "suggested_actions": ["Refresh Live Dispatch optimization"],
        "limitations": [message],
        "artifacts": [_table(title, message, [], [])],
    }


def _column(key: str, label: str, fmt: str = "text") -> dict:
    return {"key": key, "label": label, "format": fmt}


def _table(title: str, subtitle: str, columns: list[dict], rows: list[dict]) -> dict:
    return {"id": re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"), "type": "table", "title": title, "subtitle": subtitle, "columns": columns, "rows": rows, "metrics": []}


def _metrics(title: str, values: list[tuple[str, Any, str, str]]) -> dict:
    return {
        "id": re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"),
        "type": "metrics", "title": title, "subtitle": "Live operational snapshot",
        "columns": [], "rows": [],
        "metrics": [{"label": label, "value": str(value), "detail": detail, "tone": tone} for label, value, detail, tone in values],
    }
