from __future__ import annotations

import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any


DEFAULT_DATABASE_URL = "postgresql://anwar:anwar_local_dev@127.0.0.1:5432/anwar"


class StorageUnavailable(RuntimeError):
    pass


class ConcurrencyConflict(RuntimeError):
    pass


class PostgresCommandCenterStore:
    mutable_columns = {
        "status",
        "priority",
        "priority_override_reason",
        "assigned_unit_id",
        "receiving_hospital_id",
        "owning_agency",
        "acknowledged_at",
        "assigned_at",
        "resolved_at",
        "sla_deadline",
    }

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
        self.migration_file = (
            Path(__file__).resolve().parents[3]
            / "infrastructure"
            / "postgres"
            / "init"
            / "003_command_center.sql"
        )

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row

            return psycopg.connect(self.database_url, row_factory=dict_row)
        except Exception as exc:
            raise StorageUnavailable(f"PostgreSQL unavailable: {exc}") from exc

    @staticmethod
    def _json(value: object):
        from psycopg.types.json import Jsonb

        return Jsonb(value, dumps=lambda item: json.dumps(item, default=str))

    def migrate(self) -> None:
        try:
            with self._connect() as connection:
                connection.execute(self.migration_file.read_text(encoding="utf-8"))
        except StorageUnavailable:
            raise
        except Exception as exc:
            raise StorageUnavailable(f"Command Center migration failed: {exc}") from exc

    def ping(self) -> bool:
        try:
            with self._connect() as connection:
                connection.execute("SELECT 1").fetchone()
            return True
        except StorageUnavailable:
            return False

    def get_cursor(self) -> int:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT last_event_id FROM command_center.consumer_cursors WHERE consumer_name = 'signal-fusion'"
            ).fetchone()
        return int(row["last_event_id"]) if row else 0

    def advance_source_cursor(self, event_id: int) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO command_center.consumer_cursors(consumer_name, last_event_id, updated_at)
                VALUES ('signal-fusion', %s, NOW())
                ON CONFLICT (consumer_name) DO UPDATE SET
                    last_event_id = GREATEST(command_center.consumer_cursors.last_event_id, EXCLUDED.last_event_id),
                    updated_at = NOW()
                """,
                (event_id,),
            )

    def consume_source_event(self, event: dict[str, Any], incident: dict[str, Any]) -> str:
        with self._connect() as connection:
            current = connection.execute(
                "SELECT source_version, priority_override_reason FROM command_center.incidents WHERE id = %s FOR UPDATE",
                (incident["id"],),
            ).fetchone()
            outcome = "created" if current is None else "updated"
            if current and int(current["source_version"]) >= int(incident["source_version"]):
                outcome = "ignored"
            else:
                params = self._incident_params(incident)
                connection.execute(
                    """
                    INSERT INTO command_center.incidents (
                        id, source_cluster_id, source_version, title, summary, category,
                        priority, original_priority, severity, confidence, location,
                        latitude, longitude, first_reported_at, last_reported_at,
                        signal_count, duplicate_count, source_mix, source_signal_ids,
                        key_facts, risk_flags, recommended_actions, sla_deadline
                    ) VALUES (
                        %(id)s, %(source_cluster_id)s, %(source_version)s, %(title)s,
                        %(summary)s, %(category)s, %(priority)s, %(original_priority)s,
                        %(severity)s, %(confidence)s, %(location)s, %(latitude)s,
                        %(longitude)s, %(first_reported_at)s, %(last_reported_at)s,
                        %(signal_count)s, %(duplicate_count)s, %(source_mix)s,
                        %(source_signal_ids)s, %(key_facts)s, %(risk_flags)s,
                        %(recommended_actions)s, %(sla_deadline)s
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        source_version = EXCLUDED.source_version,
                        title = EXCLUDED.title,
                        summary = EXCLUDED.summary,
                        category = EXCLUDED.category,
                        priority = CASE
                            WHEN command_center.incidents.priority_override_reason IS NULL THEN EXCLUDED.priority
                            ELSE command_center.incidents.priority
                        END,
                        original_priority = EXCLUDED.original_priority,
                        severity = EXCLUDED.severity,
                        confidence = EXCLUDED.confidence,
                        location = EXCLUDED.location,
                        latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude,
                        last_reported_at = EXCLUDED.last_reported_at,
                        signal_count = EXCLUDED.signal_count,
                        duplicate_count = EXCLUDED.duplicate_count,
                        source_mix = EXCLUDED.source_mix,
                        source_signal_ids = EXCLUDED.source_signal_ids,
                        key_facts = EXCLUDED.key_facts,
                        risk_flags = EXCLUDED.risk_flags,
                        recommended_actions = EXCLUDED.recommended_actions,
                        sla_deadline = CASE
                            WHEN command_center.incidents.priority_override_reason IS NULL THEN EXCLUDED.sla_deadline
                            ELSE command_center.incidents.sla_deadline
                        END,
                        updated_at = NOW()
                    """,
                    params,
                )
                row = connection.execute(
                    "SELECT command_version FROM command_center.incidents WHERE id = %s",
                    (incident["id"],),
                ).fetchone()
                self._insert_audit(
                    connection,
                    incident["id"],
                    "incident_ingested" if outcome == "created" else "incident_source_updated",
                    "signal-fusion",
                    None,
                    "new" if outcome == "created" else None,
                    {"source_event_id": event["id"], "source_version": event["aggregate_version"]},
                )
                self._insert_outbox(
                    connection,
                    f"command_center.incident.{outcome}.v1",
                    incident["id"],
                    int(row["command_version"]),
                    {"incident_id": incident["id"], "source_version": incident["source_version"]},
                )
            connection.execute(
                """
                INSERT INTO command_center.consumer_cursors(consumer_name, last_event_id, updated_at)
                VALUES ('signal-fusion', %s, NOW())
                ON CONFLICT (consumer_name) DO UPDATE SET
                    last_event_id = GREATEST(command_center.consumer_cursors.last_event_id, EXCLUDED.last_event_id),
                    updated_at = NOW()
                """,
                (event["id"],),
            )
            return outcome

    def list_incidents(self, *, include_closed: bool = False) -> list[dict[str, Any]]:
        where = "" if include_closed else "WHERE status NOT IN ('resolved', 'cancelled')"
        with self._connect() as connection:
            rows = connection.execute(
                f"""SELECT * FROM command_center.incidents {where}
                ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
                sla_deadline ASC, created_at ASC"""
            ).fetchall()
        return [dict(row) for row in rows]

    def get_incident(self, incident_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM command_center.incidents WHERE id = %s", (incident_id,)
            ).fetchone()
        return dict(row) if row else None

    def update_incident(
        self,
        incident_id: str,
        expected_version: int,
        changes: dict[str, Any],
        *,
        event_type: str,
        actor: str,
        from_state: str | None,
        to_state: str | None,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        invalid = set(changes) - self.mutable_columns
        if invalid:
            raise ValueError(f"Unsupported incident fields: {sorted(invalid)}")
        assignments = ", ".join(f"{column} = %({column})s" for column in changes)
        params = {**changes, "id": incident_id, "expected_version": expected_version}
        with self._connect() as connection:
            row = connection.execute(
                f"""UPDATE command_center.incidents SET {assignments},
                    command_version = command_version + 1, updated_at = NOW()
                WHERE id = %(id)s AND command_version = %(expected_version)s
                RETURNING *""",
                params,
            ).fetchone()
            if row is None:
                raise ConcurrencyConflict("Incident changed since it was read")
            self._insert_audit(connection, incident_id, event_type, actor, from_state, to_state, payload)
            self._insert_outbox(
                connection,
                f"command_center.incident.{event_type}.v1",
                incident_id,
                int(row["command_version"]),
                {"incident_id": incident_id, "status": row["status"], **payload},
            )
            return dict(row)

    def assign(
        self,
        incident_id: str,
        expected_version: int,
        changes: dict[str, Any],
        *,
        actor: str,
        rationale: str | None,
        from_state: str,
    ) -> dict[str, Any]:
        with self._connect() as connection:
            connection.execute(
                """UPDATE command_center.assignments SET status = 'superseded', ended_at = NOW()
                WHERE incident_id = %s AND status = 'active'""",
                (incident_id,),
            )
            row = connection.execute(
                """UPDATE command_center.incidents SET
                    status = 'assigned', assigned_unit_id = %(assigned_unit_id)s,
                    receiving_hospital_id = %(receiving_hospital_id)s,
                    owning_agency = %(owning_agency)s, assigned_at = NOW(),
                    command_version = command_version + 1, updated_at = NOW()
                WHERE id = %(id)s AND command_version = %(expected_version)s
                RETURNING *""",
                {**changes, "id": incident_id, "expected_version": expected_version},
            ).fetchone()
            if row is None:
                raise ConcurrencyConflict("Incident changed since it was read")
            connection.execute(
                """INSERT INTO command_center.assignments(
                    incident_id, unit_id, receiving_hospital_id, status, assigned_by, rationale
                ) VALUES (%s, %s, %s, 'active', %s, %s)""",
                (incident_id, changes["assigned_unit_id"], changes["receiving_hospital_id"], actor, rationale),
            )
            payload = {
                "unit_id": changes["assigned_unit_id"],
                "receiving_hospital_id": changes["receiving_hospital_id"],
                "rationale": rationale,
            }
            self._insert_audit(connection, incident_id, "assigned", actor, from_state, "assigned", payload)
            self._insert_outbox(
                connection,
                "command_center.incident.assigned.v1",
                incident_id,
                int(row["command_version"]),
                {"incident_id": incident_id, **payload},
            )
            return dict(row)

    def list_assignments(self, incident_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM command_center.assignments WHERE incident_id = %s ORDER BY id DESC",
                (incident_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_audit(self, incident_id: str | None, limit: int) -> list[dict[str, Any]]:
        where = "WHERE incident_id = %s" if incident_id else ""
        params = (incident_id, limit) if incident_id else (limit,)
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM command_center.audit_events {where} ORDER BY id DESC LIMIT %s",
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def list_events(self, after: int, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT id, event_type, aggregate_id, aggregate_version, payload, created_at
                FROM command_center.outbox_events WHERE id > %s ORDER BY id LIMIT %s""",
                (after, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def _incident_params(self, incident: dict[str, Any]) -> dict[str, Any]:
        return {
            **incident,
            "source_mix": self._json(incident["source_mix"]),
            "source_signal_ids": self._json(incident["source_signal_ids"]),
            "key_facts": self._json(incident["key_facts"]),
            "risk_flags": self._json(incident["risk_flags"]),
            "recommended_actions": self._json(incident["recommended_actions"]),
        }

    def _insert_audit(self, connection, incident_id, event_type, actor, from_state, to_state, payload):
        connection.execute(
            """INSERT INTO command_center.audit_events(
                incident_id, event_type, actor, from_state, to_state, payload
            ) VALUES (%s, %s, %s, %s, %s, %s)""",
            (incident_id, event_type, actor, from_state, to_state, self._json(payload)),
        )

    def _insert_outbox(self, connection, event_type, aggregate_id, aggregate_version, payload):
        connection.execute(
            """INSERT INTO command_center.outbox_events(
                event_type, aggregate_id, aggregate_version, payload
            ) VALUES (%s, %s, %s, %s)
            ON CONFLICT (event_type, aggregate_id, aggregate_version) DO NOTHING""",
            (event_type, aggregate_id, aggregate_version, self._json(payload)),
        )


class MemoryCommandCenterStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self.incidents: dict[str, dict[str, Any]] = {}
        self.assignments: list[dict[str, Any]] = []
        self.audit: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.cursor = 0

    def migrate(self) -> None:
        return None

    def ping(self) -> bool:
        return True

    def get_cursor(self) -> int:
        return self.cursor

    def advance_source_cursor(self, event_id: int) -> None:
        with self._lock:
            self.cursor = max(self.cursor, event_id)

    def consume_source_event(self, event, incident) -> str:
        with self._lock:
            current = self.incidents.get(incident["id"])
            if current and current["source_version"] >= incident["source_version"]:
                outcome = "ignored"
            elif current:
                preserved = {
                    key: current.get(key)
                    for key in (
                        "command_version", "status", "assigned_unit_id", "receiving_hospital_id",
                        "owning_agency", "priority_override_reason", "acknowledged_at", "assigned_at",
                        "resolved_at", "created_at",
                    )
                }
                priority = current["priority"] if current.get("priority_override_reason") else incident["priority"]
                deadline = current["sla_deadline"] if current.get("priority_override_reason") else incident["sla_deadline"]
                self.incidents[incident["id"]] = {**incident, **preserved, "priority": priority, "sla_deadline": deadline, "updated_at": datetime.now(timezone.utc)}
                outcome = "updated"
            else:
                now = datetime.now(timezone.utc)
                self.incidents[incident["id"]] = {
                    **deepcopy(incident), "command_version": 1, "status": "new",
                    "assigned_unit_id": None, "receiving_hospital_id": None, "owning_agency": None,
                    "priority_override_reason": None, "acknowledged_at": None, "assigned_at": None,
                    "resolved_at": None, "created_at": now, "updated_at": now,
                }
                outcome = "created"
            self.cursor = max(self.cursor, event["id"])
            if outcome != "ignored":
                self._audit(incident["id"], "incident_ingested" if outcome == "created" else "incident_source_updated", "signal-fusion", None, None, {})
                self._outbox(f"command_center.incident.{outcome}.v1", self.incidents[incident["id"]])
            return outcome

    def list_incidents(self, *, include_closed=False):
        items = list(self.incidents.values())
        if not include_closed:
            items = [item for item in items if item["status"] not in {"resolved", "cancelled"}]
        rank = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}
        return sorted(deepcopy(items), key=lambda item: (rank[item["priority"]], item["sla_deadline"]))

    def get_incident(self, incident_id):
        item = self.incidents.get(incident_id)
        return deepcopy(item) if item else None

    def update_incident(self, incident_id, expected_version, changes, *, event_type, actor, from_state, to_state, payload):
        current = self.incidents[incident_id]
        if current["command_version"] != expected_version:
            raise ConcurrencyConflict("Incident changed since it was read")
        current.update(deepcopy(changes))
        current["command_version"] += 1
        current["updated_at"] = datetime.now(timezone.utc)
        self._audit(incident_id, event_type, actor, from_state, to_state, payload)
        self._outbox(f"command_center.incident.{event_type}.v1", current)
        return deepcopy(current)

    def assign(self, incident_id, expected_version, changes, *, actor, rationale, from_state):
        row = self.update_incident(
            incident_id, expected_version,
            {**changes, "status": "assigned", "assigned_at": datetime.now(timezone.utc)},
            event_type="assigned", actor=actor, from_state=from_state, to_state="assigned",
            payload={"unit_id": changes["assigned_unit_id"], "rationale": rationale},
        )
        for assignment in self.assignments:
            if assignment["incident_id"] == incident_id and assignment["status"] == "active":
                assignment["status"] = "superseded"
                assignment["ended_at"] = datetime.now(timezone.utc)
        self.assignments.append({
            "id": len(self.assignments) + 1, "incident_id": incident_id,
            "unit_id": changes["assigned_unit_id"], "receiving_hospital_id": changes["receiving_hospital_id"],
            "status": "active", "assigned_by": actor, "rationale": rationale,
            "assigned_at": datetime.now(timezone.utc), "ended_at": None,
        })
        return row

    def list_assignments(self, incident_id):
        return list(reversed([deepcopy(item) for item in self.assignments if item["incident_id"] == incident_id]))

    def list_audit(self, incident_id, limit):
        items = [item for item in self.audit if incident_id is None or item["incident_id"] == incident_id]
        return list(reversed(deepcopy(items)))[:limit]

    def list_events(self, after, limit):
        return [deepcopy(item) for item in self.events if item["id"] > after][:limit]

    def _audit(self, incident_id, event_type, actor, from_state, to_state, payload):
        self.audit.append({
            "id": len(self.audit) + 1, "incident_id": incident_id, "event_type": event_type,
            "actor": actor, "from_state": from_state, "to_state": to_state,
            "payload": deepcopy(payload), "created_at": datetime.now(timezone.utc),
        })

    def _outbox(self, event_type, incident):
        self.events.append({
            "id": len(self.events) + 1, "event_type": event_type,
            "aggregate_id": incident["id"], "aggregate_version": incident["command_version"],
            "payload": {"incident_id": incident["id"], "status": incident["status"]},
            "created_at": datetime.now(timezone.utc),
        })
