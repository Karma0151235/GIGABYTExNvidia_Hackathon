from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from importlib import import_module
from threading import RLock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


store_module = import_module("backend.modules.command-center.services.store")
PostgresCommandCenterStore = store_module.PostgresCommandCenterStore
StorageUnavailable = store_module.StorageUnavailable
ConcurrencyConflict = store_module.ConcurrencyConflict


class SourceUnavailable(RuntimeError):
    pass


class InvalidTransition(RuntimeError):
    pass


class IncidentNotFound(KeyError):
    pass


class SignalFusionFeedClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("SIGNAL_FUSION_API_URL", "http://127.0.0.1:8000/api/signal-fusion")).rstrip("/")

    def events(self, after: int, limit: int = 100) -> dict[str, Any]:
        request = Request(
            f"{self.base_url}/events?after={after}&limit={limit}",
            headers={"User-Agent": "ANWAR-Command-Center/1.0"},
        )
        try:
            with urlopen(request, timeout=4) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise SourceUnavailable(f"Signal Fusion event feed unavailable: {exc}") from exc


class CommandCenterService:
    sla_minutes = {"P1": 8, "P2": 15, "P3": 30, "P4": 60}
    closed_statuses = {"resolved", "cancelled"}
    transitions = {
        "new": {"acknowledged", "cancelled"},
        "acknowledged": {"assigned", "resolved", "cancelled"},
        "assigned": {"en_route", "acknowledged", "cancelled"},
        "en_route": {"on_scene", "assigned", "cancelled"},
        "on_scene": {"transporting", "resolved", "cancelled"},
        "transporting": {"resolved", "on_scene"},
        "resolved": {"acknowledged"},
        "cancelled": {"acknowledged"},
    }

    def __init__(self, store=None, source=None) -> None:
        self.store = store or PostgresCommandCenterStore()
        self.source = source or SignalFusionFeedClient()
        self._ready = False
        self._lock = RLock()
        self._source_online = False

    def _ensure_ready(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            self.store.migrate()
            self._ready = True

    def health(self) -> dict[str, Any]:
        storage_online = self.store.ping()
        if storage_online and not self._ready:
            try:
                self._ensure_ready()
            except StorageUnavailable:
                storage_online = False
        return {
            "status": "ok" if storage_online else "degraded",
            "storage": "postgresql",
            "storage_online": storage_online,
            "source_online": self._source_online,
            "source_cursor": self.store.get_cursor() if storage_online else 0,
        }

    def sync(self, limit: int = 100) -> dict[str, Any]:
        self._ensure_ready()
        cursor = self.store.get_cursor()
        feed = self.source.events(cursor, limit)
        self._source_online = True
        counts = {"created": 0, "updated": 0, "ignored": 0}
        for event in feed.get("events", []):
            if event.get("event_type") not in {
                "signal_fusion.incident.promoted.v1",
                "signal_fusion.incident.updated.v1",
            }:
                self.store.advance_source_cursor(int(event["id"]))
                counts["ignored"] += 1
                cursor = max(cursor, int(event["id"]))
                continue
            incident = self._source_incident(event["payload"], event["aggregate_version"])
            outcome = self.store.consume_source_event(event, incident)
            counts[outcome] += 1
            cursor = max(cursor, int(event["id"]))
        cursor = max(cursor, int(feed.get("next_cursor", cursor)))
        return {
            "consumed": sum(counts.values()),
            **counts,
            "cursor": cursor,
            "source_online": True,
        }

    def snapshot(self, *, sync: bool = True) -> dict[str, Any]:
        self._ensure_ready()
        if sync:
            try:
                self.sync()
            except SourceUnavailable:
                self._source_online = False
        now = datetime.now(timezone.utc)
        incidents = [self._public(item, now) for item in self.store.list_incidents()]
        acknowledged = [item for item in incidents if item["acknowledged_at"]]
        ack_minutes = [
            (item["acknowledged_at"] - item["created_at"]).total_seconds() / 60
            for item in acknowledged
        ]
        met = sum(item["sla_status"] in {"on_target", "met"} for item in incidents)
        return {
            "generated_at": now,
            "source_cursor": self.store.get_cursor(),
            "source_online": self._source_online,
            "stats": {
                "active_incidents": len(incidents),
                "unacknowledged": sum(item["status"] == "new" for item in incidents),
                "critical_incidents": sum(item["priority"] == "P1" for item in incidents),
                "assigned_incidents": sum(bool(item["assigned_unit_id"]) for item in incidents),
                "unassigned_incidents": sum(not item["assigned_unit_id"] for item in incidents),
                "breached_sla": sum(item["sla_status"] == "breached" for item in incidents),
                "at_risk_sla": sum(item["sla_status"] == "at_risk" for item in incidents),
                "target_met_percent": round((met / len(incidents)) * 100, 1) if incidents else 100.0,
                "average_acknowledgement_minutes": round(sum(ack_minutes) / len(ack_minutes), 1) if ack_minutes else None,
            },
            "incidents": incidents,
        }

    def list_incidents(self, *, include_closed: bool = False) -> list[dict[str, Any]]:
        self._ensure_ready()
        now = datetime.now(timezone.utc)
        return [self._public(item, now) for item in self.store.list_incidents(include_closed=include_closed)]

    def get_incident(self, incident_id: str) -> dict[str, Any]:
        self._ensure_ready()
        return self._public(self._get(incident_id), datetime.now(timezone.utc))

    def acknowledge(self, incident_id: str, *, actor: str, note: str | None, expected_version: int | None) -> dict[str, Any]:
        current = self._get(incident_id)
        if current["status"] == "acknowledged":
            return self._public(current, datetime.now(timezone.utc))
        if current["status"] != "new":
            raise InvalidTransition(f"Cannot acknowledge an incident in {current['status']} state")
        now = datetime.now(timezone.utc)
        row = self.store.update_incident(
            incident_id,
            expected_version or current["command_version"],
            {"status": "acknowledged", "acknowledged_at": now},
            event_type="acknowledged",
            actor=actor,
            from_state=current["status"],
            to_state="acknowledged",
            payload={"note": note} if note else {},
        )
        return self._public(row, now)

    def transition(self, incident_id: str, target: str, *, actor: str, note: str | None, expected_version: int | None) -> dict[str, Any]:
        current = self._get(incident_id)
        if target == current["status"]:
            return self._public(current, datetime.now(timezone.utc))
        if target not in self.transitions[current["status"]]:
            raise InvalidTransition(f"Invalid transition: {current['status']} -> {target}")
        now = datetime.now(timezone.utc)
        changes: dict[str, Any] = {"status": target}
        if target == "acknowledged" and current.get("acknowledged_at") is None:
            changes["acknowledged_at"] = now
        if target in self.closed_statuses:
            changes["resolved_at"] = now
        elif current["status"] in self.closed_statuses:
            changes["resolved_at"] = None
        row = self.store.update_incident(
            incident_id,
            expected_version or current["command_version"],
            changes,
            event_type=f"status_{target}",
            actor=actor,
            from_state=current["status"],
            to_state=target,
            payload={"note": note} if note else {},
        )
        return self._public(row, now)

    def assign(self, incident_id: str, payload: dict[str, Any], *, actor: str) -> dict[str, Any]:
        current = self._get(incident_id)
        if current["status"] in self.closed_statuses:
            raise InvalidTransition(f"Cannot assign an incident in {current['status']} state")
        if current["status"] == "new":
            raise InvalidTransition("Acknowledge the incident before assigning a unit")
        row = self.store.assign(
            incident_id,
            payload.get("expected_version") or current["command_version"],
            {
                "assigned_unit_id": payload["unit_id"],
                "receiving_hospital_id": payload.get("receiving_hospital_id"),
                "owning_agency": payload.get("owning_agency"),
            },
            actor=actor,
            rationale=payload.get("rationale"),
            from_state=current["status"],
        )
        return self._public(row, datetime.now(timezone.utc))

    def override_priority(self, incident_id: str, priority: str, *, reason: str, actor: str, expected_version: int | None) -> dict[str, Any]:
        current = self._get(incident_id)
        if current["status"] in self.closed_statuses:
            raise InvalidTransition("Closed incidents cannot be reprioritized")
        deadline = self._as_datetime(current["first_reported_at"]) + timedelta(minutes=self.sla_minutes[priority])
        row = self.store.update_incident(
            incident_id,
            expected_version or current["command_version"],
            {"priority": priority, "priority_override_reason": reason, "sla_deadline": deadline},
            event_type="priority_overridden",
            actor=actor,
            from_state=current["status"],
            to_state=current["status"],
            payload={"from_priority": current["priority"], "to_priority": priority, "reason": reason},
        )
        return self._public(row, datetime.now(timezone.utc))

    def assignments(self, incident_id: str) -> list[dict[str, Any]]:
        self._get(incident_id)
        return self.store.list_assignments(incident_id)

    def audit(self, incident_id: str | None, limit: int) -> list[dict[str, Any]]:
        self._ensure_ready()
        if incident_id:
            self._get(incident_id)
        return self.store.list_audit(incident_id, limit)

    def events(self, after: int, limit: int) -> dict[str, Any]:
        self._ensure_ready()
        events = self.store.list_events(after, limit)
        return {"events": events, "next_cursor": events[-1]["id"] if events else after}

    def _get(self, incident_id: str) -> dict[str, Any]:
        self._ensure_ready()
        item = self.store.get_incident(incident_id)
        if item is None:
            raise IncidentNotFound(incident_id)
        return item

    def _source_incident(self, source: dict[str, Any], version: int) -> dict[str, Any]:
        first_reported = self._as_datetime(source["first_reported_at"])
        priority = source["priority"]
        return {
            "id": source["id"],
            "source_cluster_id": source["source_cluster_id"],
            "source_version": version,
            "title": source["title"],
            "summary": source["summary"],
            "category": source["category"],
            "priority": priority,
            "original_priority": priority,
            "severity": source["severity"],
            "confidence": source["confidence"],
            "location": source["location"],
            "latitude": source["latitude"],
            "longitude": source["longitude"],
            "first_reported_at": first_reported,
            "last_reported_at": self._as_datetime(source["last_reported_at"]),
            "signal_count": source["signal_count"],
            "duplicate_count": source["duplicate_count"],
            "source_mix": source["source_mix"],
            "source_signal_ids": source["source_signal_ids"],
            "key_facts": source["key_facts"],
            "risk_flags": source["risk_flags"],
            "recommended_actions": source["recommended_actions"],
            "sla_deadline": first_reported + timedelta(minutes=self.sla_minutes[priority]),
        }

    def _public(self, row: dict[str, Any], now: datetime) -> dict[str, Any]:
        item = dict(row)
        for key in (
            "first_reported_at", "last_reported_at", "sla_deadline", "acknowledged_at",
            "assigned_at", "resolved_at", "created_at", "updated_at",
        ):
            if item.get(key) is not None:
                item[key] = self._as_datetime(item[key])
        deadline = item["sla_deadline"]
        reference = item.get("resolved_at") or now
        remaining = int((deadline - reference).total_seconds())
        if item.get("resolved_at"):
            sla_status = "met" if remaining >= 0 else "breached"
        elif remaining < 0:
            sla_status = "breached"
        elif remaining <= max(120, self.sla_minutes[item["priority"]] * 60 * 0.25):
            sla_status = "at_risk"
        else:
            sla_status = "on_target"
        item["sla_status"] = sla_status
        item["sla_seconds_remaining"] = remaining
        return item

    @staticmethod
    def _as_datetime(value: datetime | str) -> datetime:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


service = CommandCenterService()
