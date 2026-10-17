from __future__ import annotations

import uuid
from datetime import datetime, timezone
from importlib import import_module
from typing import Any

from . import copilot_service, query_catalog
from .store import PostgresAssistantStore


SOPS = {
    "operator-approval": {
        "owner": "ANWAR Operations",
        "version": "pilot-1",
        "content": "Review current evidence and use the Command Center or Smart Dispatch controls to record every operational decision. The assistant cannot make or submit decisions.",
    },
    "dispatch-review": {
        "owner": "ANWAR Operations",
        "version": "pilot-1",
        "content": "Confirm unit capability, ETA, availability, and destination status before accepting a recommendation. Escalate conflicting or stale information to the dispatcher.",
    },
}


class LiveContext:
    """Read-only adapter over the three implemented operational modules."""

    def snapshot(self) -> dict[str, Any]:
        limitations: list[str] = []
        context: dict[str, Any] = {"fusion": {}, "incidents": [], "units": [], "facilities": [], "dispatches": [], "risks": [], "limitations": limitations}
        try:
            command = import_module("backend.modules.command-center.services.command_service").service
            context["incidents"] = command.list_incidents()
        except Exception:
            limitations.append("Command Center data is currently unavailable.")
        try:
            dispatch = import_module("backend.modules.live-dispatch.services.dispatch_service").dispatch_service
            context["units"] = dispatch.units()
            context["facilities"] = dispatch.facilities()
            context["dispatches"] = dispatch.dispatches(include_closed=True)
        except Exception:
            limitations.append("Smart Dispatch data is currently unavailable.")
        try:
            fusion = import_module("backend.modules.signal-fusion.services.fusion_engine").engine
            context["fusion"] = fusion.snapshot()
            context["risks"] = fusion.list_risks()
        except Exception:
            limitations.append("Signal Fusion risk data is currently unavailable.")
        return context


class DispatchAssistantService:
    def __init__(self, store=None, context=None) -> None:
        self.store = store or PostgresAssistantStore()
        self.context = context or LiveContext()
        self._ready = False

    def _ensure_ready(self) -> None:
        if not self._ready:
            self.store.migrate()
            self._ready = True

    def query(self, question: str, *, incident_id: str | None = None, session_id: str | None = None) -> dict:
        self._ensure_ready()
        session_id = session_id or f"ASST-{uuid.uuid4().hex[:12].upper()}"
        context = self.context.snapshot()
        result = self._answer(question.strip(), incident_id, context)
        record = self.store.save({
            "session_id": session_id,
            "incident_id": incident_id,
            "question": question.strip(),
            **result,
        })
        return {"session_id": session_id, **result, "generated_at": record["created_at"]}

    def copilot(self, question: str, *, incident_id: str | None = None, session_id: str | None = None) -> dict:
        self._ensure_ready()
        session_id = session_id or f"ASST-{uuid.uuid4().hex[:12].upper()}"
        question = question.strip()
        context = self.context.snapshot()
        history = self.store.session(session_id, limit=4)
        previous_query_id = history[-1]["intent"] if history else None
        query_result = query_catalog.execute(question, context, incident_id, previous_query_id)
        result = None
        try:
            result = copilot_service.copilot_answer(
                question,
                incident_id=query_result["query"]["focus_incident_id"],
                context=context,
                query_result=query_result,
                history=history,
            )
        except Exception as exc:
            query_result["limitations"].append(f"OpenRouter narrative unavailable ({type(exc).__name__}); verified query result shown.")
        if result is None:
            result = {
                **query_result,
                "intent": query_result["query"]["id"],
                "provider": "deterministic",
                "model": "anwar-static-query-catalog",
            }
        record = self.store.save({
            "session_id": session_id,
            "incident_id": incident_id,
            "question": question,
            "intent": result["intent"],
            "answer": result["answer"],
            "sources": result["sources"],
            "suggested_actions": result["suggested_actions"],
            "limitations": result["limitations"],
        })
        return {"session_id": session_id, **result, "generated_at": record["created_at"]}

    def session(self, session_id: str) -> list[dict]:
        self._ensure_ready()
        return self.store.session(session_id)

    @staticmethod
    def sop(topic: str) -> dict | None:
        item = SOPS.get(topic)
        return {"topic": topic, **item} if item else None

    def _answer(self, question: str, incident_id: str | None, context: dict) -> dict:
        intent = self._intent(question)
        limitations = list(context["limitations"])
        incident = next((item for item in context["incidents"] if item["id"] == incident_id), None) if incident_id else None
        if incident_id and not incident:
            limitations.append(f"Incident {incident_id} is not present in the current Command Center snapshot.")
        if intent == "unsupported":
            return self._result(
                intent, "I can only explain current unit recommendations, unassigned critical incidents, eligible units, hospital and route status, or recommended next actions.", [], [], limitations
            )
        if intent == "unassigned_critical":
            rows = [item for item in context["incidents"] if item.get("priority") == "P1" and not item.get("assigned_unit_id")]
            names = ", ".join(f"{item['id']} ({item['title']})" for item in rows) or "None"
            return self._result(intent, f"Unassigned critical incidents: {names}.", [f"command-center:incidents/{item['id']}" for item in rows] or ["command-center:snapshot"], ["Open Command Center incident queue"], limitations)
        if not incident and intent != "why_unit":
            return self._result(intent, "Select an active incident to answer this question from current operational data.", [], [], limitations + ["An incident ID is required for this question."])
        dispatch = self._dispatch_for(incident_id, question, context["dispatches"])
        if intent == "why_unit":
            if not dispatch:
                return self._result(intent, "There is no current dispatch recommendation for that unit or incident.", [], [], limitations)
            unit = next((item for item in context["units"] if item["id"] == dispatch["unit_id"]), None)
            answer = dispatch["decision_reason"]
            if unit:
                answer += f" {unit['id']} is currently {unit['status']} with capabilities: {', '.join(unit['capabilities'])}."
            return self._result(intent, answer, [f"live-dispatch:dispatches/{dispatch['id']}", f"command-center:incidents/{dispatch['incident_id']}"], ["Review Smart Dispatch recommendation", "Use operator approval controls if appropriate"], limitations)
        if intent == "eligible_units":
            if not dispatch:
                return self._result(intent, "No current recommendation is available to identify eligible units.", [f"command-center:incidents/{incident_id}"], ["Generate or refresh the Smart Dispatch recommendation"], limitations)
            rows = [item for item in dispatch.get("alternatives", []) if item.get("eligible")]
            names = ", ".join(f"{item['unit_id']} ({item['eta_minutes']:.1f} min ETA)" for item in rows) or "No eligible routed units"
            return self._result(intent, f"Eligible units for {incident_id}: {names}.", [f"live-dispatch:dispatches/{dispatch['id']}"], ["Review Smart Dispatch recommendation"], limitations)
        if intent == "hospital":
            facilities = self._eligible_facilities(incident, context["facilities"])
            selected = next((item for item in facilities if dispatch and item["id"] == dispatch.get("receiving_facility_id")), None)
            alternatives = [item for item in facilities if not selected or item["id"] != selected["id"]]
            if not facilities:
                return self._result(intent, "No currently accepting facility matches the operational capability filter.", [f"command-center:incidents/{incident_id}"], ["Review facility availability"], limitations)
            selected_text = f"{selected['name']} is selected" if selected else "No facility is selected"
            alternative_text = ", ".join(f"{item['name']} ({item['ed_load_percent']}% ED load)" for item in alternatives) or "no alternatives"
            return self._result(intent, f"{selected_text}. Current accepting alternatives: {alternative_text}.", [f"live-dispatch:facilities/{item['id']}" for item in facilities] + ([f"live-dispatch:dispatches/{dispatch['id']}"] if dispatch else []), ["Review destination and capacity in Smart Dispatch"], limitations)
        if intent == "route":
            if not dispatch:
                return self._result(intent, "No current route is available for this incident.", [f"command-center:incidents/{incident_id}"], ["Generate or refresh the Smart Dispatch recommendation"], limitations)
            return self._result(intent, f"Current scene ETA is {dispatch['scene_eta_minutes']:.1f} minutes. Route status is based on the latest saved recommendation; no live disruption feed is connected in this pilot.", [f"live-dispatch:dispatches/{dispatch['id']}"], ["Review route in Smart Dispatch"], limitations)
        actions = incident.get("recommended_actions", [])
        text = "; ".join(actions) if actions else "Review the incident, confirm the current recommendation, and record any decision through the operator controls."
        return self._result(intent, f"Recommended next actions for {incident_id}: {text}", [f"command-center:incidents/{incident_id}"], ["Open Command Center incident", "Review Smart Dispatch recommendation"], limitations)

    @staticmethod
    def _result(intent: str, answer: str, sources: list[str], suggested_actions: list[str], limitations: list[str]) -> dict:
        return {"intent": intent, "answer": answer, "sources": sources or ["dispatch-assistant:scope/pilot-1"], "suggested_actions": suggested_actions, "limitations": limitations}

    @staticmethod
    def _intent(question: str) -> str:
        text = question.lower()
        if "unassigned" in text and ("critical" in text or "p1" in text): return "unassigned_critical"
        if ("hospital" in text or "facility" in text) and any(word in text for word in ("why", "selected", "capacity", "alternative")): return "hospital"
        if any(word in text for word in ("route", "eta", "disruption")): return "route"
        if "eligible" in text and ("unit" in text or "ambulance" in text): return "eligible_units"
        if any(phrase in text for phrase in ("next action", "recommended action", "what should")): return "next_actions"
        if "why" in text and any(word in text for word in ("recommend", "unit", "ambulance", "amb-")): return "why_unit"
        return "unsupported"

    @staticmethod
    def _dispatch_for(incident_id: str | None, question: str, dispatches: list[dict]) -> dict | None:
        text = question.upper()
        matches = [item for item in dispatches if (incident_id and item["incident_id"] == incident_id) or item["unit_id"].upper() in text]
        active = [item for item in matches if item["status"] not in {"rejected", "completed", "cancelled"}]
        return (active or matches or [None])[0]

    @staticmethod
    def _eligible_facilities(incident: dict, facilities: list[dict]) -> list[dict]:
        category = incident.get("category", "").upper()
        needed = "TRAUMA" if any(word in category for word in ("TRAUMA", "ACCIDENT", "COLLISION")) else None
        rows = [item for item in facilities if item.get("facility_type") == "hospital" and item.get("accepting_patients")]
        return [item for item in rows if not needed or needed in {value.upper() for value in item.get("capabilities", [])}]


service = DispatchAssistantService()
