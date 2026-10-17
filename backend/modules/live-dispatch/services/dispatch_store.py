from __future__ import annotations

import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any


DEFAULT_DATABASE_URL = "postgresql://anwar:anwar_local_dev@127.0.0.1:5432/anwar"


class DispatchStorageUnavailable(RuntimeError):
    pass


class DispatchConflict(RuntimeError):
    pass


class PostgresDispatchStore:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
        self.migration_file = Path(__file__).resolve().parents[3] / "infrastructure" / "postgres" / "init" / "004_live_dispatch.sql"

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
            return psycopg.connect(self.database_url, row_factory=dict_row)
        except Exception as exc:
            raise DispatchStorageUnavailable(f"PostgreSQL unavailable: {exc}") from exc

    @staticmethod
    def _json(value):
        from psycopg.types.json import Jsonb
        return Jsonb(value, dumps=lambda item: json.dumps(item, default=str))

    def migrate(self):
        try:
            with self._connect() as connection:
                connection.execute(self.migration_file.read_text(encoding="utf-8"))
        except DispatchStorageUnavailable:
            raise
        except Exception as exc:
            raise DispatchStorageUnavailable(f"Live Dispatch migration failed: {exc}") from exc

    def ping(self):
        try:
            with self._connect() as connection:
                connection.execute("SELECT 1").fetchone()
            return True
        except DispatchStorageUnavailable:
            return False

    def list_units(self):
        with self._connect() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM live_dispatch.units ORDER BY id").fetchall()]

    def get_unit(self, unit_id):
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM live_dispatch.units WHERE id = %s", (unit_id,)).fetchone()
        return dict(row) if row else None

    def get_cursor(self):
        with self._connect() as connection:
            row = connection.execute("SELECT last_event_id FROM live_dispatch.consumer_cursors WHERE consumer_name='command-center'").fetchone()
        return int(row["last_event_id"]) if row else 0

    def set_cursor(self, cursor):
        with self._connect() as connection:
            connection.execute("""INSERT INTO live_dispatch.consumer_cursors(consumer_name,last_event_id,updated_at)
            VALUES ('command-center',%s,NOW()) ON CONFLICT (consumer_name) DO UPDATE SET
            last_event_id=GREATEST(live_dispatch.consumer_cursors.last_event_id,EXCLUDED.last_event_id),updated_at=NOW()""",(cursor,))

    def list_facilities(self):
        with self._connect() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM live_dispatch.facilities ORDER BY name").fetchall()]

    def get_active_dispatch(self, incident_id, *, backup=False):
        with self._connect() as connection:
            row = connection.execute(
                """SELECT * FROM live_dispatch.dispatches WHERE incident_id = %s AND is_backup = %s
                AND status IN ('recommended','accepted','en_route','on_scene','transporting')
                ORDER BY recommended_at DESC LIMIT 1""", (incident_id, backup)
            ).fetchone()
        return dict(row) if row else None

    def get_dispatch(self, dispatch_id):
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM live_dispatch.dispatches WHERE id = %s", (dispatch_id,)).fetchone()
        return dict(row) if row else None

    def list_dispatches(self, include_closed=False):
        where = "" if include_closed else "WHERE status NOT IN ('rejected','completed','cancelled')"
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM live_dispatch.dispatches {where} ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, scene_eta_minutes"
            ).fetchall()
        return [dict(row) for row in rows]

    def save_recommendation(self, recommendation):
        try:
            with self._connect() as connection:
                if not recommendation.get("is_backup"):
                    connection.execute(
                        """UPDATE live_dispatch.dispatches SET status = 'cancelled', updated_at = NOW(), version = version + 1
                        WHERE incident_id = %s AND is_backup = FALSE AND status = 'recommended'""",
                        (recommendation["incident_id"],),
                    )
                params = self._dispatch_params(recommendation)
                row = connection.execute(
                    """INSERT INTO live_dispatch.dispatches(
                    id, incident_id, incident_version, priority, severity, category, status, is_backup,
                    unit_id, receiving_facility_id, optimization_score, score_breakdown, alternatives,
                    origin_coordinate, scene_coordinate, destination_coordinate, route_to_scene,
                    route_to_hospital, scene_distance_km, scene_eta_minutes, hospital_distance_km,
                    hospital_eta_minutes, algorithm_version, decision_reason
                ) VALUES (
                    %(id)s, %(incident_id)s, %(incident_version)s, %(priority)s, %(severity)s,
                    %(category)s, %(status)s, %(is_backup)s, %(unit_id)s, %(receiving_facility_id)s,
                    %(optimization_score)s, %(score_breakdown)s, %(alternatives)s,
                    %(origin_coordinate)s, %(scene_coordinate)s, %(destination_coordinate)s,
                    %(route_to_scene)s, %(route_to_hospital)s, %(scene_distance_km)s,
                    %(scene_eta_minutes)s, %(hospital_distance_km)s, %(hospital_eta_minutes)s,
                    %(algorithm_version)s, %(decision_reason)s
                    ) RETURNING *""", params
                ).fetchone()
                self._audit(connection, row["id"], row["incident_id"], "recommended", "optimizer", None, "recommended", {
                    "unit_id": row["unit_id"], "score": row["optimization_score"], "eta_minutes": row["scene_eta_minutes"],
                })
                self._outbox(connection, "live_dispatch.recommendation.created.v1", row)
                return dict(row)
        except Exception as exc:
            if getattr(exc, "sqlstate", None) == "23505":
                raise DispatchConflict("Unit or incident already has an active dispatch") from exc
            raise

    def update_dispatch(self, dispatch_id, expected_version, status, *, actor, note=None, reason=None):
        unit_status = {
            "accepted": "dispatched", "en_route": "en_route", "on_scene": "on_scene",
            "transporting": "transporting", "completed": "at_hospital", "cancelled": "available", "rejected": None,
        }[status]
        with self._connect() as connection:
            current = connection.execute("SELECT * FROM live_dispatch.dispatches WHERE id = %s FOR UPDATE", (dispatch_id,)).fetchone()
            if current is None:
                return None
            if int(current["version"]) != int(expected_version):
                raise DispatchConflict("Dispatch changed since it was read")
            row = connection.execute(
                """UPDATE live_dispatch.dispatches SET status = %(status)s,
                    operator_id = %(actor)s, operator_note = COALESCE(%(note)s, operator_note),
                    rejection_reason = COALESCE(%(reason)s, rejection_reason),
                    accepted_at = CASE WHEN %(is_accept)s THEN NOW() ELSE accepted_at END,
                    completed_at = CASE WHEN %(is_close)s THEN NOW() ELSE completed_at END,
                    updated_at = NOW(), version = version + 1
                WHERE id = %(id)s RETURNING *""",
                {"id": dispatch_id, "status": status, "actor": actor, "note": note, "reason": reason,
                 "is_accept": status == "accepted", "is_close": status in {"completed", "cancelled"}},
            ).fetchone()
            if unit_status:
                release = status in {"completed", "cancelled"}
                connection.execute(
                    """UPDATE live_dispatch.units SET status = %s, active_incident_id = %s,
                    version = version + 1, updated_at = NOW() WHERE id = %s""",
                    (unit_status, None if release else row["incident_id"], row["unit_id"]),
                )
            self._audit(connection, dispatch_id, row["incident_id"], status, actor, current["status"], status, {"note": note, "reason": reason})
            self._outbox(connection, f"live_dispatch.dispatch.{status}.v1", row)
            return dict(row)

    def update_route(self, dispatch_id, expected_version, route):
        with self._connect() as connection:
            row = connection.execute(
                """UPDATE live_dispatch.dispatches SET origin_coordinate=%(origin)s,
                route_to_scene=%(route)s, scene_distance_km=%(distance)s,
                scene_eta_minutes=%(eta)s, updated_at=NOW(), version=version+1
                WHERE id=%(id)s AND version=%(version)s RETURNING *""",
                {"id": dispatch_id, "version": expected_version, "origin": self._json(route["origin_coordinate"]),
                 "route": self._json(route["coordinates"]), "distance": route["distance_km"], "eta": route["duration_minutes"]},
            ).fetchone()
            if row is None:
                raise DispatchConflict("Dispatch changed before route recalculation")
            self._audit(connection, dispatch_id, row["incident_id"], "route_recalculated", "routing-engine", row["status"], row["status"], {"eta_minutes": row["scene_eta_minutes"]})
            self._outbox(connection, "live_dispatch.route.recalculated.v1", row)
            return dict(row)

    def reroute_dispatch(self, dispatch_id, expected_version, facility, route, *, actor, reason, disruption_evidence=None):
        with self._connect() as connection:
            current = connection.execute("SELECT * FROM live_dispatch.dispatches WHERE id = %s FOR UPDATE", (dispatch_id,)).fetchone()
            if current is None:
                return None
            if int(current["version"]) != int(expected_version):
                raise DispatchConflict("Dispatch changed since it was read")
            row = connection.execute(
                """UPDATE live_dispatch.dispatches SET receiving_facility_id=%(facility_id)s,
                destination_coordinate=%(destination)s, route_to_hospital=%(route)s,
                hospital_distance_km=%(distance)s, hospital_eta_minutes=%(eta)s,
                operator_id=%(actor)s, operator_note=%(reason)s, updated_at=NOW(), version=version+1
                WHERE id=%(id)s RETURNING *""",
                {"id": dispatch_id, "facility_id": facility["id"],
                 "destination": self._json([facility["longitude"], facility["latitude"]]),
                 "route": self._json(route["coordinates"]), "distance": route["distance_km"],
                 "eta": route["duration_minutes"], "actor": actor, "reason": reason},
            ).fetchone()
            self._audit(connection, dispatch_id, row["incident_id"], "rerouted", actor, current["status"], row["status"], {
                "original_facility_id": current["receiving_facility_id"], "revised_facility_id": row["receiving_facility_id"],
                "reason": reason, "disruption_evidence": disruption_evidence, "eta_minutes": row["hospital_eta_minutes"],
            })
            self._outbox(connection, "live_dispatch.dispatch.rerouted.v1", row)
            return dict(row), current["receiving_facility_id"]

    def record_care_event(self, dispatch_id, event_type, *, actor, payload):
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM live_dispatch.dispatches WHERE id=%s", (dispatch_id,)).fetchone()
            if row is None:
                return None
            self._audit(connection, dispatch_id, row["incident_id"], event_type, actor, row["status"], row["status"], payload)
            self._outbox(connection, f"live_dispatch.care.{event_type}.v1", row, payload=payload, aggregate_id=payload.get("draft_id"))
            return dict(row)

    def update_unit_location(self, unit_id, expected_version, payload):
        with self._connect() as connection:
            current = connection.execute("SELECT version FROM live_dispatch.units WHERE id=%s", (unit_id,)).fetchone()
            if current is None:
                return None
            version = expected_version or current["version"]
            row = connection.execute(
                """UPDATE live_dispatch.units SET latitude=%(latitude)s, longitude=%(longitude)s,
                heading=%(heading)s, speed_kph=%(speed_kph)s, location_updated_at=NOW(),
                updated_at=NOW(), version=version+1 WHERE id=%(id)s AND version=%(version)s RETURNING *""",
                {**payload, "id": unit_id, "version": version},
            ).fetchone()
            if row is None:
                raise DispatchConflict("Unit location changed since it was read")
            return dict(row)

    def update_facility(self, facility_id, changes):
        allowed = {"accepting_patients", "ed_load_percent", "ambulance_bays"}
        changes = {key: value for key, value in changes.items() if key in allowed and value is not None}
        if not changes:
            with self._connect() as connection:
                row = connection.execute("SELECT * FROM live_dispatch.facilities WHERE id=%s", (facility_id,)).fetchone()
            return dict(row) if row else None
        setters = ",".join(f"{key}=%({key})s" for key in changes)
        with self._connect() as connection:
            row = connection.execute(f"UPDATE live_dispatch.facilities SET {setters}, updated_at=NOW() WHERE id=%(id)s RETURNING *", {**changes, "id": facility_id}).fetchone()
        return dict(row) if row else None

    def list_audit(self, dispatch_id, limit):
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM live_dispatch.audit_events WHERE dispatch_id=%s ORDER BY id DESC LIMIT %s", (dispatch_id, limit)).fetchall()
        return [dict(row) for row in rows]

    def list_events(self, after, limit):
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM live_dispatch.outbox_events WHERE id>%s ORDER BY id LIMIT %s", (after, limit)).fetchall()
        return [dict(row) for row in rows]

    def _dispatch_params(self, item):
        return {**item, **{key: self._json(item.get(key)) for key in (
            "score_breakdown", "alternatives", "origin_coordinate", "scene_coordinate",
            "destination_coordinate", "route_to_scene", "route_to_hospital",
        )}}

    def _audit(self, connection, dispatch_id, incident_id, event_type, actor, from_state, to_state, payload):
        connection.execute("INSERT INTO live_dispatch.audit_events(dispatch_id,incident_id,event_type,actor,from_state,to_state,payload) VALUES (%s,%s,%s,%s,%s,%s,%s)", (dispatch_id, incident_id, event_type, actor, from_state, to_state, self._json(payload)))

    def _outbox(self, connection, event_type, row, *, payload=None, aggregate_id=None):
        event_payload = {"dispatch_id": row["id"], "incident_id": row["incident_id"], "unit_id": row["unit_id"], "status": row["status"], "receiving_facility_id": row["receiving_facility_id"], "eta_minutes": row["scene_eta_minutes"], **(payload or {})}
        event_payload["dispatch_id"] = row["id"]
        connection.execute("INSERT INTO live_dispatch.outbox_events(event_type,aggregate_id,aggregate_version,payload) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING", (event_type, aggregate_id or row["id"], row["version"], self._json(event_payload)))


class MemoryDispatchStore:
    def __init__(self, units=None, facilities=None):
        self._lock = RLock()
        self.units = {item["id"]: deepcopy(item) for item in (units or [])}
        self.facilities = {item["id"]: deepcopy(item) for item in (facilities or [])}
        self.dispatches = {}
        self.audit = []
        self.events = []
        self.cursor = 0

    def migrate(self): return None
    def ping(self): return True
    def list_units(self): return list(deepcopy(self.units).values())
    def get_cursor(self): return self.cursor
    def set_cursor(self,cursor): self.cursor=max(self.cursor,cursor)
    def get_unit(self, unit_id): return deepcopy(self.units.get(unit_id))
    def list_facilities(self): return list(deepcopy(self.facilities).values())
    def get_active_dispatch(self, incident_id, *, backup=False):
        return next((deepcopy(item) for item in reversed(list(self.dispatches.values())) if item["incident_id"] == incident_id and item.get("is_backup", False) == backup and item["status"] in {"recommended","accepted","en_route","on_scene","transporting"}), None)
    def get_dispatch(self, dispatch_id): return deepcopy(self.dispatches.get(dispatch_id))
    def list_dispatches(self, include_closed=False):
        items = list(self.dispatches.values())
        return deepcopy(items if include_closed else [item for item in items if item["status"] not in {"rejected","completed","cancelled"}])
    def save_recommendation(self, item):
        now = datetime.now(timezone.utc)
        row = {**deepcopy(item), "operator_id": None, "operator_note": None, "rejection_reason": None, "recommended_at": now, "accepted_at": None, "completed_at": None, "updated_at": now, "version": 1}
        self.dispatches[row["id"]] = row
        self._event("live_dispatch.recommendation.created.v1", row)
        return deepcopy(row)
    def update_dispatch(self, dispatch_id, expected_version, status, *, actor, note=None, reason=None):
        row = self.dispatches.get(dispatch_id)
        if not row: return None
        if row["version"] != expected_version: raise DispatchConflict("Dispatch changed since it was read")
        old = row["status"]; row.update({"status": status, "operator_id": actor, "operator_note": note or row.get("operator_note"), "rejection_reason": reason or row.get("rejection_reason"), "updated_at": datetime.now(timezone.utc), "version": row["version"] + 1})
        if status == "accepted": row["accepted_at"] = datetime.now(timezone.utc)
        if status in {"completed","cancelled"}: row["completed_at"] = datetime.now(timezone.utc)
        unit = self.units[row["unit_id"]]
        mapping = {"accepted":"dispatched","en_route":"en_route","on_scene":"on_scene","transporting":"transporting","completed":"at_hospital","cancelled":"available"}
        if status in mapping:
            unit["status"] = mapping[status]; unit["active_incident_id"] = None if status in {"completed","cancelled"} else row["incident_id"]
        self.audit.append({"id":len(self.audit)+1,"dispatch_id":dispatch_id,"incident_id":row["incident_id"],"event_type":status,"actor":actor,"from_state":old,"to_state":status,"payload":{},"created_at":datetime.now(timezone.utc)})
        self._event(f"live_dispatch.dispatch.{status}.v1", row)
        return deepcopy(row)
    def update_route(self, dispatch_id, expected_version, route):
        row=self.dispatches[dispatch_id]
        if row["version"] != expected_version: raise DispatchConflict("Dispatch changed")
        row.update({"origin_coordinate":route["origin_coordinate"],"route_to_scene":route["coordinates"],"scene_distance_km":route["distance_km"],"scene_eta_minutes":route["duration_minutes"],"version":row["version"]+1,"updated_at":datetime.now(timezone.utc)})
        self._event("live_dispatch.route.recalculated.v1",row); return deepcopy(row)
    def reroute_dispatch(self, dispatch_id, expected_version, facility, route, *, actor, reason, disruption_evidence=None):
        row = self.dispatches.get(dispatch_id)
        if not row: return None
        if row["version"] != expected_version: raise DispatchConflict("Dispatch changed since it was read")
        previous = row.get("receiving_facility_id")
        row.update({"receiving_facility_id": facility["id"], "destination_coordinate": [facility["longitude"], facility["latitude"]],
                    "route_to_hospital": route["coordinates"], "hospital_distance_km": route["distance_km"],
                    "hospital_eta_minutes": route["duration_minutes"], "operator_id": actor, "operator_note": reason,
                    "version": row["version"] + 1, "updated_at": datetime.now(timezone.utc)})
        self.audit.append({"id": len(self.audit)+1, "dispatch_id": dispatch_id, "incident_id": row["incident_id"],
                           "event_type": "rerouted", "actor": actor, "from_state": row["status"], "to_state": row["status"],
                           "payload": {"original_facility_id": previous, "revised_facility_id": facility["id"], "reason": reason, "disruption_evidence": disruption_evidence}, "created_at": datetime.now(timezone.utc)})
        self._event("live_dispatch.dispatch.rerouted.v1", row)
        return deepcopy(row), previous
    def record_care_event(self, dispatch_id, event_type, *, actor, payload):
        row = self.dispatches.get(dispatch_id)
        if not row: return None
        self.audit.append({"id": len(self.audit)+1, "dispatch_id": dispatch_id, "incident_id": row["incident_id"],
                           "event_type": event_type, "actor": actor, "from_state": row["status"], "to_state": row["status"],
                           "payload": deepcopy(payload), "created_at": datetime.now(timezone.utc)})
        self._event(f"live_dispatch.care.{event_type}.v1", row, payload=payload, aggregate_id=payload.get("draft_id"))
        return deepcopy(row)
    def update_unit_location(self, unit_id, expected_version, payload):
        row=self.units.get(unit_id)
        if not row:return None
        if expected_version and row["version"] != expected_version:raise DispatchConflict("Unit changed")
        row.update(payload);row["version"]+=1;row["location_updated_at"]=datetime.now(timezone.utc);row["updated_at"]=datetime.now(timezone.utc);return deepcopy(row)
    def update_facility(self, facility_id, changes):
        row=self.facilities.get(facility_id)
        if row:row.update({k:v for k,v in changes.items() if v is not None})
        return deepcopy(row)
    def list_audit(self, dispatch_id, limit): return list(reversed([deepcopy(item) for item in self.audit if item["dispatch_id"]==dispatch_id]))[:limit]
    def list_events(self, after, limit): return [deepcopy(item) for item in self.events if item["id"]>after][:limit]
    def _event(self,event_type,row,*,payload=None,aggregate_id=None):
        event_payload={"dispatch_id":row["id"],"incident_id":row["incident_id"],"unit_id":row["unit_id"],"status":row["status"],**(payload or {})}
        event_payload["dispatch_id"]=row["id"]
        self.events.append({"id":len(self.events)+1,"event_type":event_type,"aggregate_id":aggregate_id or row["id"],"aggregate_version":row["version"],"payload":event_payload,"created_at":datetime.now(timezone.utc)})
