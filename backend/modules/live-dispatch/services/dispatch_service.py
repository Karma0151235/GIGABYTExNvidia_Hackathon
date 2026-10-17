from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from importlib import import_module
from math import hypot
from threading import RLock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


store_module = import_module("backend.modules.live-dispatch.services.dispatch_store")
routing_module = import_module("backend.modules.live-dispatch.services.routing_service")
PostgresDispatchStore = store_module.PostgresDispatchStore
DispatchStorageUnavailable = store_module.DispatchStorageUnavailable
DispatchConflict = store_module.DispatchConflict
RoutingUnavailable = routing_module.RoutingUnavailable
routing_service = routing_module.routing_service


class CommandCenterUnavailable(RuntimeError):
    pass


class DispatchNotFound(KeyError):
    pass


class UnitNotFound(KeyError):
    pass


class NoEligibleUnit(RuntimeError):
    pass


class InvalidDispatchTransition(RuntimeError):
    pass


class CommandCenterClient:
    def __init__(self, base_url=None):
        self.base_url = (base_url or os.getenv("COMMAND_CENTER_API_URL", "http://127.0.0.1:8000/api/command-center")).rstrip("/")

    async def incidents(self):
        return await asyncio.to_thread(self._request, "/incidents")

    async def events(self, after, limit=100):
        return await asyncio.to_thread(self._request, f"/events?after={after}&limit={limit}")

    async def acknowledge(self, incident, actor, note=None):
        return await asyncio.to_thread(self._request, f"/incidents/{incident['id']}/acknowledge", "POST", {
            "note": note or "Live Dispatch operator accepted the optimized response",
            "expected_version": incident["command_version"],
        }, actor)

    async def assign(self, incident, unit_id, hospital_id, actor, reason):
        return await asyncio.to_thread(self._request, f"/incidents/{incident['id']}/assign", "POST", {
            "unit_id": unit_id, "receiving_hospital_id": hospital_id, "rationale": reason,
            "expected_version": incident["command_version"],
        }, actor)

    async def transition(self, incident, status, actor, note=None):
        return await asyncio.to_thread(self._request, f"/incidents/{incident['id']}/transition", "POST", {
            "status": status, "note": note, "expected_version": incident["command_version"],
        }, actor)

    def _request(self, path, method="GET", payload=None, actor="live-dispatch"):
        data = json.dumps(payload).encode() if payload is not None else None
        request = Request(f"{self.base_url}{path}", data=data, method=method, headers={
            "Content-Type": "application/json", "X-Operator-Id": actor, "User-Agent": "ANWAR-Live-Dispatch/1.0",
        })
        try:
            with urlopen(request, timeout=6) as response:
                return json.loads(response.read().decode())
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise CommandCenterUnavailable(f"Command Center rejected request ({exc.code}): {detail}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise CommandCenterUnavailable(f"Command Center unavailable: {exc}") from exc


class LiveDispatchService:
    algorithm_version = "anwar-priority-v1"
    active_statuses = {"recommended", "accepted", "en_route", "on_scene", "transporting"}
    transitions = {
        "accepted": {"en_route", "cancelled"},
        "en_route": {"on_scene", "cancelled"},
        "on_scene": {"transporting", "completed", "cancelled"},
        "transporting": {"completed", "cancelled"},
    }

    def __init__(self, store=None, router=None, command=None):
        self.store = store or PostgresDispatchStore()
        self.router = router or routing_service
        self.command = command or CommandCenterClient()
        self._ready = False
        self._lock = RLock()
        self._command_online = False

    def _ensure_ready(self):
        if self._ready: return
        with self._lock:
            if self._ready: return
            self.store.migrate(); self._ready = True

    async def health(self):
        self._ensure_ready()
        routing_online = await self.router.health()
        return {"status": "ok" if self.store.ping() and routing_online else "degraded", "storage_online": self.store.ping(), "routing_online": routing_online, "command_center_online": self._command_online, "algorithm_version": self.algorithm_version}

    async def optimize_all(self):
        self._ensure_ready()
        try:
            cursor = self.store.get_cursor()
            feed = await self.command.events(cursor)
            self.store.set_cursor(feed.get("next_cursor", cursor))
            incidents = await self.command.incidents(); self._command_online = True
        except CommandCenterUnavailable:
            self._command_online = False; raise
        incidents = [item for item in incidents if item["status"] not in {"resolved", "cancelled"}]
        priority_rank = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}
        incidents.sort(key=lambda item: (priority_rank[item["priority"]], item["sla_seconds_remaining"], -item["severity"]))
        reserved = {item["unit_id"] for item in self.store.list_dispatches() if item["status"] != "recommended"}
        results = []
        for incident in incidents:
            current = self.store.get_active_dispatch(incident["id"])
            if current and current["status"] in {"accepted", "en_route", "on_scene", "transporting"}:
                results.append(current)
                reserved.add(current["unit_id"])
                continue
            if current and current["incident_version"] >= incident["command_version"]:
                results.append(current); reserved.add(current["unit_id"]); continue
            try:
                recommendation = await self.optimize_incident(
                    incident,
                    excluded_units=reserved - ({incident["assigned_unit_id"]} if incident.get("assigned_unit_id") else set()),
                    forced_unit_id=incident.get("assigned_unit_id"),
                )
                results.append(recommendation); reserved.add(recommendation["unit_id"])
            except NoEligibleUnit:
                continue
        return results

    async def optimize_incident(self, incident, *, excluded_units=None, forced_unit_id=None, is_backup=False, required_capability=None):
        self._ensure_ready()
        excluded_units = set(excluded_units or [])
        excluded_units.update(
            item["unit_id"]
            for item in self.store.list_dispatches()
            if item["incident_id"] != incident["id"] or item.get("is_backup", False) or is_backup
        )
        required = self.required_capabilities(incident)
        if required_capability: required.add(required_capability.upper())
        units = self.store.list_units()
        candidate_units = []
        rejected = []
        for unit in units:
            missing = sorted(required - {item.upper() for item in unit["capabilities"]})
            available = unit["status"] in {"available", "at_hospital"} or unit.get("active_incident_id") == incident["id"]
            eligible = available and unit["id"] not in excluded_units and not missing
            if forced_unit_id and unit["id"] != forced_unit_id: eligible = False
            if not eligible:
                rejected.append(self._candidate(unit, False, missing, "Unavailable or missing required capability"))
            else: candidate_units.append(unit)
        if not candidate_units:
            raise NoEligibleUnit(f"No eligible unit for {incident['id']}; required capabilities: {sorted(required)}")

        scene = [incident["longitude"], incident["latitude"]]
        routed = await asyncio.gather(*(self._route_candidate(unit, scene) for unit in candidate_units), return_exceptions=True)
        scores = []
        for unit, route in zip(candidate_units, routed, strict=True):
            if isinstance(route, Exception):
                rejected.append(self._candidate(unit, False, [], "OSRM could not calculate a route")); continue
            scores.append(self.score_candidate(incident, unit, route, required))
        if not scores: raise NoEligibleUnit(f"No routable eligible unit for {incident['id']}")
        scores.sort(key=lambda item: (-item["score"], item["eta_minutes"], item["unit_id"]))
        best = scores[0]
        unit = next(item for item in candidate_units if item["id"] == best["unit_id"])
        facility = await self.select_facility(incident, scene)
        hospital_route = None
        if facility:
            hospital_route = await self.router.route([scene, [facility["longitude"], facility["latitude"]]])
        recommendation = {
            "id": f"DSP-{incident['id']}-{uuid.uuid4().hex[:8].upper()}", "incident_id": incident["id"],
            "incident_version": incident["command_version"], "priority": incident["priority"], "severity": incident["severity"],
            "category": incident["category"], "status": "recommended", "is_backup": is_backup, "unit_id": unit["id"],
            "receiving_facility_id": facility["id"] if facility else None, "optimization_score": best["score"],
            "score_breakdown": {key: best[key] for key in ("eta_score","capability_score","readiness_score","agency_score","workload_score","sla_urgency")},
            "alternatives": [*scores, *rejected], "origin_coordinate": [unit["longitude"], unit["latitude"]],
            "scene_coordinate": scene, "destination_coordinate": [facility["longitude"], facility["latitude"]] if facility else None,
            "route_to_scene": best["route"]["coordinates"], "route_to_hospital": hospital_route["coordinates"] if hospital_route else None,
            "scene_distance_km": best["distance_km"], "scene_eta_minutes": best["eta_minutes"],
            "hospital_distance_km": hospital_route["distance_km"] if hospital_route else None,
            "hospital_eta_minutes": hospital_route["duration_minutes"] if hospital_route else None,
            "algorithm_version": self.algorithm_version,
            "decision_reason": f"{unit['id']} ranked first for {incident['priority']} {incident['category']}: {best['eta_minutes']:.1f} min ETA, capability match {best['capability_score']:.0%}, score {best['score']:.3f}.",
        }
        return self.store.save_recommendation(recommendation)

    def score_candidate(self, incident, unit, route, required):
        eta_score = max(0.0, 1 - route["duration_minutes"] / 30)
        capability_score = 1.0 if not required else len(required & {item.upper() for item in unit["capabilities"]}) / len(required)
        readiness_score = 1.0 if unit["status"] == "available" else 0.75
        agency_score = 1.0 if not incident.get("owning_agency") or unit["agency"] == incident.get("owning_agency") else 0.65
        workload_score = 1.0 if not unit.get("active_incident_id") else 0.2
        sla_urgency = max(0.0, min(1.0, 1 - incident.get("sla_seconds_remaining", 3600) / 3600))
        weights = {"P1": (0.58,0.25,0.08,0.04,0.05), "P2": (0.50,0.25,0.10,0.07,0.08), "P3": (0.42,0.25,0.13,0.08,0.12), "P4": (0.35,0.25,0.15,0.10,0.15)}[incident["priority"]]
        score = eta_score*weights[0] + capability_score*weights[1] + readiness_score*weights[2] + agency_score*weights[3] + workload_score*weights[4] + sla_urgency*(0.08 if incident["priority"] == "P1" else 0.03)
        return {**self._candidate(unit, True, [], "Eligible and routed"), "score": round(score, 4), "eta_minutes": route["duration_minutes"], "distance_km": route["distance_km"], "eta_score":round(eta_score,4), "capability_score":round(capability_score,4), "readiness_score":readiness_score, "agency_score":agency_score, "workload_score":workload_score, "sla_urgency":round(sla_urgency,4), "route":route}

    async def select_facility(self, incident, scene):
        facilities = [item for item in self.store.list_facilities() if item["facility_type"] == "hospital" and item["accepting_patients"]]
        if incident.get("receiving_hospital_id"):
            selected = next((item for item in facilities if item["id"] == incident["receiving_hospital_id"]), None)
            if selected: return selected
        needed = self.patient_capabilities(incident)
        eligible = [item for item in facilities if needed <= {cap.upper() for cap in item["capabilities"]}] or facilities
        return min(eligible, key=lambda item: item["ed_load_percent"]*0.006 + hypot(item["longitude"]-scene[0], item["latitude"]-scene[1])*10) if eligible else None

    async def care_options(self, incident_id):
        self._ensure_ready()
        dispatch = self.store.get_active_dispatch(incident_id)
        if dispatch is None:
            raise DispatchNotFound(f"Active dispatch for incident {incident_id} was not found")
        incident = await self._command_incident(incident_id)
        required = sorted(self.patient_capabilities(incident))
        scene = dispatch["scene_coordinate"]
        facilities = [item for item in self.store.list_facilities() if item["facility_type"] == "hospital"]
        routes = await asyncio.gather(*(self.router.route([scene, [item["longitude"], item["latitude"]]]) for item in facilities), return_exceptions=True)
        options = []
        for facility, route in zip(facilities, routes, strict=True):
            capabilities = {item.upper() for item in facility["capabilities"]}
            matches = set(required) <= capabilities
            eligible = facility["accepting_patients"] and matches
            if isinstance(route, Exception):
                options.append(self._care_option(facility, required, eligible, matches, None, "Route unavailable"))
            else:
                options.append(self._care_option(facility, required, eligible, matches, route, self._care_reason(facility, required, matches)))
        options.sort(key=lambda item: (not item["eligible"], -item["score"], item["facility"]["name"]))
        options = options[:3]
        current = next((item for item in options if item["facility"]["id"] == dispatch.get("receiving_facility_id")), None)
        if current is None and dispatch.get("receiving_facility_id"):
            facility = next((item for item in facilities if item["id"] == dispatch["receiving_facility_id"]), None)
            if facility:
                current = self._care_option(facility, required, facility["accepting_patients"] and set(required) <= {item.upper() for item in facility["capabilities"]}, set(required) <= {item.upper() for item in facility["capabilities"]}, None, "Current destination is outside the top three")
        return {"incident_id": incident_id, "dispatch_id": dispatch["id"], "dispatch_version": dispatch["version"], "required_capabilities": required, "current_plan": current, "options": options}

    async def reroute(self, dispatch_id, payload, actor):
        dispatch = self._get(dispatch_id)
        if dispatch["status"] not in self.active_statuses:
            raise InvalidDispatchTransition("Only active dispatches can be rerouted")
        choices = await self.care_options(dispatch["incident_id"])
        selected = next((item for item in choices["options"] if item["facility"]["id"] == payload["facility_id"]), None)
        if selected is None:
            facility = next((item for item in self.store.list_facilities() if item["id"] == payload["facility_id"] and item["facility_type"] == "hospital"), None)
            if facility is None:
                raise KeyError(payload["facility_id"])
            incident = await self._command_incident(dispatch["incident_id"])
            required = sorted(self.patient_capabilities(incident))
            eligible = facility["accepting_patients"] and set(required) <= {item.upper() for item in facility["capabilities"]}
            if not eligible and not payload.get("override_ineligible"):
                raise InvalidDispatchTransition("Selected facility is ineligible; explicit override is required")
        else:
            facility = selected["facility"]
            required = selected["required_capabilities"]
            if not selected["eligible"] and not payload.get("override_ineligible"):
                raise InvalidDispatchTransition("Selected facility is ineligible; explicit override is required")
        route = await self.router.route([dispatch["scene_coordinate"], [facility["longitude"], facility["latitude"]]])
        result = self.store.reroute_dispatch(dispatch_id, payload["expected_version"], facility, route, actor=actor, reason=payload["reason"], disruption_evidence=payload.get("disruption_evidence"))
        if result is None:
            raise DispatchNotFound(dispatch_id)
        row, previous = result
        return {"dispatch": row, "previous_facility_id": previous, "reason": payload["reason"]}

    async def pre_alert_draft(self, dispatch_id, actor):
        dispatch = self._get(dispatch_id)
        facility = next((item for item in self.store.list_facilities() if item["id"] == dispatch.get("receiving_facility_id")), None)
        if facility is None:
            raise InvalidDispatchTransition("A receiving facility is required before a pre-alert draft can be created")
        incident = await self._command_incident(dispatch["incident_id"])
        required = sorted(self.patient_capabilities(incident))
        eta = dispatch.get("hospital_eta_minutes")
        capability_text = ", ".join(required) if required else "general emergency care"
        message = f"DRAFT ONLY — Incident {dispatch['incident_id']} ({incident['category']}); required capability: {capability_text}; destination: {facility['name']}; ETA: {eta:.1f} min." if eta is not None else f"DRAFT ONLY — Incident {dispatch['incident_id']} ({incident['category']}); required capability: {capability_text}; destination: {facility['name']}; ETA pending."
        draft_id = f"PAD-{uuid.uuid4().hex[:8].upper()}"
        self.store.record_care_event(dispatch_id, "pre_alert_drafted", actor=actor, payload={"draft_id": draft_id, "facility_id": facility["id"], "required_capabilities": required, "eta_minutes": eta, "message": message, "delivery_status": "draft_only"})
        return {"draft_id": draft_id, "dispatch_id": dispatch_id, "incident_id": dispatch["incident_id"], "facility_id": facility["id"], "required_capabilities": required, "eta_minutes": eta, "message": message, "delivery_status": "draft_only"}

    async def accept(self, dispatch_id, expected_version, actor, note=None):
        row=self._get(dispatch_id)
        if row["status"] != "recommended": raise InvalidDispatchTransition("Only recommended dispatches can be accepted")
        incident=await self._command_incident(row["incident_id"])
        if not row.get("is_backup"):
            if incident["status"] == "new":
                incident=await self.command.acknowledge(incident,actor,note)
            await self.command.assign(incident,row["unit_id"],row.get("receiving_facility_id"),actor,row["decision_reason"])
        self._command_online=True
        return self.store.update_dispatch(dispatch_id,expected_version or row["version"],"accepted",actor=actor,note=note)

    async def reject(self, dispatch_id, expected_version, actor, reason, reoptimize=True):
        row=self._get(dispatch_id)
        if row["status"] != "recommended": raise InvalidDispatchTransition("Only recommendations can be rejected")
        rejected=self.store.update_dispatch(dispatch_id,expected_version or row["version"],"rejected",actor=actor,reason=reason)
        if not reoptimize:return {"dispatch":rejected,"replacement":None}
        incident=await self._command_incident(row["incident_id"])
        replacement=await self.optimize_incident(incident,excluded_units={row["unit_id"]})
        return {"dispatch":rejected,"replacement":replacement}

    async def transition(self, dispatch_id, status, expected_version, actor, note=None):
        row=self._get(dispatch_id)
        if status not in self.transitions.get(row["status"],set()): raise InvalidDispatchTransition(f"Invalid dispatch transition: {row['status']} -> {status}")
        incident=await self._command_incident(row["incident_id"])
        command_status="resolved" if status=="completed" else status
        if not row.get("is_backup"):
            await self.command.transition(incident,command_status,actor,note)
        self._command_online=True
        return self.store.update_dispatch(dispatch_id,expected_version or row["version"],status,actor=actor,note=note)

    async def cancel(self, dispatch_id, expected_version, actor, note=None):
        row=self._get(dispatch_id)
        if row["status"] not in self.active_statuses: raise InvalidDispatchTransition("Dispatch is already closed")
        incident=await self._command_incident(row["incident_id"])
        if not row.get("is_backup"):
            await self.command.transition(incident,"cancelled",actor,note)
        self._command_online=True
        return self.store.update_dispatch(dispatch_id,expected_version or row["version"],"cancelled",actor=actor,note=note)

    async def reassign(self, dispatch_id, unit_id, expected_version, actor, reason):
        row=self._get(dispatch_id);incident=await self._command_incident(row["incident_id"])
        self.store.update_dispatch(dispatch_id,expected_version or row["version"],"cancelled",actor=actor,note=reason)
        return await self.optimize_incident(incident,forced_unit_id=unit_id)

    async def request_backup(self, dispatch_id, capability, actor, reason):
        row=self._get(dispatch_id);incident=await self._command_incident(row["incident_id"])
        return await self.optimize_incident(incident,excluded_units={row["unit_id"]},is_backup=True,required_capability=capability)

    async def update_unit_location(self, unit_id, payload):
        self._ensure_ready();unit=self.store.update_unit_location(unit_id,payload.get("expected_version"),payload)
        if unit is None:raise UnitNotFound(unit_id)
        recalculated=None
        if payload.get("recalculate_route") and unit.get("active_incident_id"):
            dispatch=self.store.get_active_dispatch(unit["active_incident_id"])
            if dispatch and dispatch["status"] in {"accepted","en_route"}:
                route=await self.router.route([[unit["longitude"],unit["latitude"]],dispatch["scene_coordinate"]]);route["origin_coordinate"]=[unit["longitude"],unit["latitude"]]
                recalculated=self.store.update_route(dispatch["id"],dispatch["version"],route)
        return {"unit":unit,"dispatch":recalculated}

    async def snapshot(self):
        self._ensure_ready()
        try:
            incidents=await self.command.incidents();self._command_online=True
            await self.optimize_all()
        except (CommandCenterUnavailable,NoEligibleUnit):
            incidents=[];self._command_online=False
        units=self.store.list_units();facilities=self.store.list_facilities();dispatches=self.store.list_dispatches()
        routes=[]
        for item in dispatches:
            hospital_id=item.get("receiving_facility_id") or "hkl"
            routes.append({"id":f"RTE-{item['id']}","unit_id":item["unit_id"],"incident_id":item["incident_id"],"hospital_id":hospital_id,"color":"#dc2626" if item["priority"]=="P1" else "#2563eb","leg":"to_scene","coordinates":item["route_to_scene"],"distance_km":item["scene_distance_km"],"duration_minutes":item["scene_eta_minutes"],"provider":"local-osrm"})
            if item.get("route_to_hospital"):
                routes.append({"id":f"RTE-HOSP-{item['id']}","unit_id":item["unit_id"],"incident_id":item["incident_id"],"hospital_id":hospital_id,"color":"#0d9488","leg":"to_hospital","coordinates":item["route_to_hospital"],"distance_km":item["hospital_distance_km"],"duration_minutes":item["hospital_eta_minutes"],"provider":"local-osrm"})
        locations=[{"id":item["id"],"name":item["name"],"kind":item["facility_type"],"coordinate":[item["longitude"],item["latitude"]],"metadata":{"capabilities":",".join(item["capabilities"]),"accepting":item["accepting_patients"],"load":item["ed_load_percent"]}} for item in facilities]
        locations += [{"id":item["id"],"name":item["title"],"kind":"incident","coordinate":[item["longitude"],item["latitude"]],"metadata":{"priority":item["priority"],"status":item["status"]}} for item in incidents]
        active=[item for item in dispatches if item["status"] in {"accepted","en_route","on_scene","transporting"}]
        return {"routing_online":await self.router.health(),"routing_provider":"local-osrm","dataset":"ANWAR live dispatch PostgreSQL + Malaysia OSM","locations":locations,"routes":routes,"failed_route_ids":[],"generated_at":datetime.now(timezone.utc),"command_center_online":self._command_online,"units":units,"facilities":facilities,"incidents":incidents,"recommendations":dispatches,"stats":{"active_incidents":len(incidents),"available_units":sum(item["status"]=="available" for item in units),"recommended":sum(item["status"]=="recommended" for item in dispatches),"active_dispatches":len(active),"average_recommended_eta":round(sum(item["scene_eta_minutes"] for item in dispatches)/len(dispatches),1) if dispatches else None,"p1_uncovered":max(0,sum(item["priority"]=="P1" for item in incidents)-sum(item["priority"]=="P1" for item in dispatches))}}

    def units(self):self._ensure_ready();return self.store.list_units()
    def facilities(self):self._ensure_ready();return self.store.list_facilities()
    def dispatches(self,include_closed=False):self._ensure_ready();return self.store.list_dispatches(include_closed)
    def audit(self,dispatch_id,limit):self._get(dispatch_id);return self.store.list_audit(dispatch_id,limit)
    def events(self,after,limit):
        self._ensure_ready();events=self.store.list_events(after,limit);return {"events":events,"next_cursor":events[-1]["id"] if events else after}
    def update_facility(self,facility_id,changes):
        self._ensure_ready();row=self.store.update_facility(facility_id,changes)
        if row is None:raise KeyError(facility_id)
        return row
    def _get(self,dispatch_id):
        self._ensure_ready();row=self.store.get_dispatch(dispatch_id)
        if row is None:raise DispatchNotFound(dispatch_id)
        return row
    async def _command_incident(self,incident_id):
        items=await self.command.incidents();item=next((value for value in items if value["id"]==incident_id),None)
        if item is None:raise CommandCenterUnavailable(f"Incident {incident_id} is no longer active")
        return item
    async def _route_candidate(self,unit,scene):return await self.router.route([[unit["longitude"],unit["latitude"]],scene])
    @staticmethod
    def _candidate(unit,eligible,missing,reason):return {"unit_id":unit["id"],"eligible":eligible,"score":0.0,"eta_minutes":None,"distance_km":None,"capability_score":0.0,"readiness_score":0.0,"agency_score":0.0,"workload_score":0.0,"missing_capabilities":missing,"reason":reason}
    @staticmethod
    def required_capabilities(incident):
        text=f"{incident.get('category','')} {' '.join(incident.get('risk_flags',[]))}".lower();required=set()
        if incident["priority"]=="P1" or incident["severity"]>=75:required.add("ALS")
        if any(word in text for word in ("trapped","extrication","rescue","fire")):required.add("RESCUE")
        if any(word in text for word in ("maternal","pregnan","obstetric")):required.add("MATERNAL")
        if any(word in text for word in ("neonatal","newborn","infant")):required.add("NEONATAL")
        if "cardiac" in text:required.add("CARDIAC")
        return required
    @staticmethod
    def patient_capabilities(incident):
        text=incident.get("category","").lower();needed=set()
        if incident["severity"]>=75:needed.add("ICU")
        if "cardiac" in text:needed.add("CARDIAC")
        if "stroke" in text:needed.add("STROKE")
        if any(word in text for word in ("trauma","accident","collision")):needed.add("TRAUMA")
        if "maternal" in text:needed.add("MATERNAL")
        return needed

    @staticmethod
    def _care_reason(facility, required, matches):
        if not facility["accepting_patients"]:
            return "Not accepting patients"
        if not matches:
            return f"Missing required capability: {', '.join(sorted(set(required) - {item.upper() for item in facility['capabilities']}))}"
        return f"Accepting with {facility['ed_load_percent']}% ED load and {facility['ambulance_bays']} ambulance bays"

    @staticmethod
    def _care_option(facility, required, eligible, matches, route, reason):
        eta = route["duration_minutes"] if route else None
        score = (100 if eligible else 0) + (20 if matches else 0) + facility["ambulance_bays"] * 2 - facility["ed_load_percent"] * 0.3 - (eta or 60)
        return {"facility": facility, "eligible": eligible, "required_capabilities": required, "capability_match": matches,
                "distance_km": route["distance_km"] if route else None, "eta_minutes": eta, "score": round(score, 2), "reason": reason}


dispatch_service = LiveDispatchService()
