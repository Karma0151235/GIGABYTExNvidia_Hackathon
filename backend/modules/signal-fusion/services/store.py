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
    """Raised when the durable Signal Fusion store cannot be reached."""


class PostgresFusionStore:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
        self.migration_file = (
            Path(__file__).resolve().parents[3]
            / "infrastructure"
            / "postgres"
            / "init"
            / "001_signal_fusion.sql"
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

        return Jsonb(
            value,
            dumps=lambda item: json.dumps(
                item,
                default=lambda nested: nested.isoformat()
                if isinstance(nested, datetime)
                else str(nested),
            ),
        )

    def migrate(self) -> None:
        sql = self.migration_file.read_text(encoding="utf-8")
        try:
            with self._connect() as connection:
                connection.execute(sql)
        except StorageUnavailable:
            raise
        except Exception as exc:
            raise StorageUnavailable(f"Signal Fusion migration failed: {exc}") from exc

    def ping(self) -> bool:
        try:
            with self._connect() as connection:
                connection.execute("SELECT 1").fetchone()
            return True
        except StorageUnavailable:
            return False

    def load_state(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        with self._connect() as connection:
            signal_rows = connection.execute(
                "SELECT * FROM signal_fusion.signals ORDER BY received_at"
            ).fetchall()
            cluster_rows = connection.execute(
                "SELECT * FROM signal_fusion.clusters ORDER BY first_seen"
            ).fetchall()
        return [self._signal_from_row(row) for row in signal_rows], [
            self._cluster_from_row(row) for row in cluster_rows
        ]

    def load_risk_state(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        with self._connect() as connection:
            signal_rows = connection.execute(
                "SELECT * FROM signal_fusion.risk_signals ORDER BY observed_at"
            ).fetchall()
            risk_rows = connection.execute(
                "SELECT * FROM signal_fusion.risks ORDER BY generated_at"
            ).fetchall()
        return [self._risk_signal_from_row(row) for row in signal_rows], [
            self._risk_from_row(row) for row in risk_rows
        ]

    def find_signal_by_external_id(self, external_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM signal_fusion.signals WHERE external_id = %s",
                (external_id,),
            ).fetchone()
        return self._signal_from_row(row) if row else None

    def find_risk_signal_by_external_id(self, external_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM signal_fusion.risk_signals WHERE external_id = %s",
                (external_id,),
            ).fetchone()
        return self._risk_signal_from_row(row) if row else None

    def get_risk(self, risk_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM signal_fusion.risks WHERE id = %s", (risk_id,)
            ).fetchone()
        return self._risk_from_row(row) if row else None

    def get_active_risk_by_zone(self, zone: str, now: datetime) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM signal_fusion.risks
                WHERE zone = %s AND expires_at > %s
                ORDER BY generated_at DESC LIMIT 1
                """,
                (zone, now),
            ).fetchone()
        return self._risk_from_row(row) if row else None

    def list_risks(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM signal_fusion.risks ORDER BY generated_at DESC"
            ).fetchall()
        return [self._risk_from_row(row) for row in rows]

    def list_risk_signals(self, zone: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM signal_fusion.risk_signals
                WHERE zone = %s
                ORDER BY observed_at
                """,
                (zone,),
            ).fetchall()
        return [self._risk_signal_from_row(row) for row in rows]

    def save_risk_assessment(
        self,
        risk_signal: dict[str, Any],
        risk: dict[str, Any],
        event_type: str | None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO signal_fusion.risks (
                    id, zone, latitude, longitude, level, confidence, evidence,
                    recommended_action, generated_at, expires_at, acknowledged_at,
                    acknowledged_by, version
                ) VALUES (
                    %(id)s, %(zone)s, %(latitude)s, %(longitude)s, %(level)s,
                    %(confidence)s, %(evidence)s, %(recommended_action)s,
                    %(generated_at)s, %(expires_at)s, %(acknowledged_at)s,
                    %(acknowledged_by)s, %(version)s
                )
                ON CONFLICT (id) DO UPDATE SET
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    level = EXCLUDED.level,
                    confidence = EXCLUDED.confidence,
                    evidence = EXCLUDED.evidence,
                    recommended_action = EXCLUDED.recommended_action,
                    generated_at = EXCLUDED.generated_at,
                    expires_at = EXCLUDED.expires_at,
                    acknowledged_at = EXCLUDED.acknowledged_at,
                    acknowledged_by = EXCLUDED.acknowledged_by,
                    version = EXCLUDED.version,
                    updated_at = NOW()
                """,
                self._risk_params(risk),
            )
            connection.execute(
                """
                INSERT INTO signal_fusion.risk_signals (
                    id, risk_id, external_id, source, zone, latitude, longitude,
                    observed_at, received_at, severity, evidence, validity_minutes
                ) VALUES (
                    %(id)s, %(risk_id)s, %(external_id)s, %(source)s, %(zone)s,
                    %(latitude)s, %(longitude)s, %(observed_at)s, %(received_at)s,
                    %(severity)s, %(evidence)s, %(validity_minutes)s
                )
                """,
                self._risk_signal_params(risk_signal),
            )
            self._insert_audit(
                connection,
                event_type="risk_signal_ingested",
                entity_type="risk_signal",
                entity_id=risk_signal["id"],
                actor="risk-engine",
                payload={"risk_id": risk["id"], "source": risk_signal["source"]},
            )
            if event_type:
                self._insert_audit(
                    connection,
                    event_type=event_type.removeprefix("signal_fusion.").removesuffix(".v1").replace(".", "_"),
                    entity_type="risk",
                    entity_id=risk["id"],
                    actor="risk-engine",
                    payload={"level": risk["level"], "version": risk["version"]},
                )
                connection.execute(
                    """
                    INSERT INTO signal_fusion.outbox_events (
                        event_type, aggregate_id, aggregate_version, payload
                    ) VALUES (%s, %s, %s, %s)
                    ON CONFLICT (event_type, aggregate_id, aggregate_version) DO NOTHING
                    """,
                    (event_type, risk["id"], risk["version"], self._json(risk)),
                )

    def save_risk_refresh(self, risk: dict[str, Any], event_type: str | None) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE signal_fusion.risks SET
                    level = %(level)s,
                    confidence = %(confidence)s,
                    evidence = %(evidence)s,
                    recommended_action = %(recommended_action)s,
                    expires_at = %(expires_at)s,
                    acknowledged_at = %(acknowledged_at)s,
                    acknowledged_by = %(acknowledged_by)s,
                    version = %(version)s,
                    updated_at = NOW()
                WHERE id = %(id)s
                """,
                self._risk_params(risk),
            )
            if event_type:
                self._insert_audit(
                    connection,
                    event_type=event_type.removeprefix("signal_fusion.").removesuffix(".v1").replace(".", "_"),
                    entity_type="risk",
                    entity_id=risk["id"],
                    actor="risk-engine",
                    payload={"level": risk["level"], "version": risk["version"]},
                )
                connection.execute(
                    """
                    INSERT INTO signal_fusion.outbox_events (
                        event_type, aggregate_id, aggregate_version, payload
                    ) VALUES (%s, %s, %s, %s)
                    ON CONFLICT (event_type, aggregate_id, aggregate_version) DO NOTHING
                    """,
                    (event_type, risk["id"], risk["version"], self._json(risk)),
                )

    def acknowledge_risk(
        self, risk_id: str, actor: str, acknowledged_at: datetime
    ) -> tuple[dict[str, Any] | None, bool]:
        with self._connect() as connection:
            row = connection.execute(
                """
                UPDATE signal_fusion.risks SET
                    acknowledged_at = %s,
                    acknowledged_by = %s,
                    version = version + 1,
                    updated_at = NOW()
                WHERE id = %s AND acknowledged_at IS NULL AND expires_at > %s
                RETURNING *
                """,
                (acknowledged_at, actor, risk_id, acknowledged_at),
            ).fetchone()
            if row is None:
                existing = connection.execute(
                    "SELECT * FROM signal_fusion.risks WHERE id = %s", (risk_id,)
                ).fetchone()
                return (self._risk_from_row(existing), False) if existing else (None, False)
            risk = self._risk_from_row(row)
            self._insert_audit(
                connection,
                event_type="risk_acknowledged",
                entity_type="risk",
                entity_id=risk["id"],
                actor=actor,
                payload={"level": risk["level"], "version": risk["version"]},
            )
            connection.execute(
                """
                INSERT INTO signal_fusion.outbox_events (
                    event_type, aggregate_id, aggregate_version, payload
                ) VALUES (%s, %s, %s, %s)
                ON CONFLICT (event_type, aggregate_id, aggregate_version) DO NOTHING
                """,
                (
                    "signal_fusion.risk.acknowledged.v1",
                    risk["id"],
                    risk["version"],
                    self._json(risk),
                ),
            )
            return risk, True

    def save_ingestion(
        self,
        signal: dict[str, Any],
        cluster: dict[str, Any],
        audit_payload: dict[str, Any],
        incident: dict[str, Any] | None = None,
    ) -> None:
        with self._connect() as connection:
            self._upsert_cluster(connection, cluster)
            connection.execute(
                """
                INSERT INTO signal_fusion.signals (
                    id, external_id, source, caller, transcript, location,
                    latitude, longitude, occurred_at, received_at, severity,
                    status, cluster_id, metadata, embedding, embedding_provider
                ) VALUES (
                    %(id)s, %(external_id)s, %(source)s, %(caller)s, %(transcript)s,
                    %(location)s, %(latitude)s, %(longitude)s, %(occurred_at)s,
                    %(received_at)s, %(severity)s, %(status)s, %(cluster_id)s,
                    %(metadata)s, %(embedding)s, %(embedding_provider)s
                )
                """,
                self._signal_params(signal),
            )
            self._insert_audit(
                connection,
                event_type="signal_ingested",
                entity_type="signal",
                entity_id=signal["id"],
                actor="fusion-engine",
                payload=audit_payload,
            )
            if incident is not None:
                connection.execute(
                    """
                    UPDATE signal_fusion.incident_handoffs SET
                        version = %(version)s,
                        summary = %(summary)s,
                        priority = %(priority)s,
                        severity = %(severity)s,
                        confidence = %(confidence)s,
                        last_reported_at = %(last_reported_at)s,
                        signal_count = %(signal_count)s,
                        duplicate_count = %(duplicate_count)s,
                        source_mix = %(source_mix)s,
                        source_signal_ids = %(source_signal_ids)s,
                        key_facts = %(key_facts)s,
                        risk_flags = %(risk_flags)s,
                        recommended_actions = %(recommended_actions)s,
                        updated_at = %(updated_at)s
                    WHERE id = %(id)s
                    """,
                    self._incident_params(incident),
                )
                connection.execute(
                    """
                    INSERT INTO signal_fusion.outbox_events (
                        event_type, aggregate_id, aggregate_version, payload
                    ) VALUES (%s, %s, %s, %s)
                    ON CONFLICT (event_type, aggregate_id, aggregate_version)
                    DO UPDATE SET payload = EXCLUDED.payload
                    """,
                    (
                        "signal_fusion.incident.updated.v1",
                        incident["id"],
                        incident["version"],
                        self._json(incident),
                    ),
                )

    def save_cluster_action(
        self,
        cluster: dict[str, Any],
        action: str,
        actor: str,
    ) -> None:
        with self._connect() as connection:
            self._upsert_cluster(connection, cluster)
            self._insert_audit(
                connection,
                event_type=f"cluster_{action}",
                entity_type="cluster",
                entity_id=cluster["id"],
                actor=actor,
                payload={"status": cluster["status"], "version": cluster["version"]},
            )

    def save_promotion(
        self,
        cluster: dict[str, Any],
        incident: dict[str, Any],
        actor: str,
    ) -> int:
        with self._connect() as connection:
            self._upsert_cluster(connection, cluster)
            connection.execute(
                """
                INSERT INTO signal_fusion.incident_handoffs (
                    id, source_cluster_id, version, state, title, summary, category,
                    priority, severity, confidence, location, latitude, longitude,
                    first_reported_at, last_reported_at, signal_count, duplicate_count,
                    source_mix, source_signal_ids, key_facts, risk_flags,
                    recommended_actions, created_at, updated_at
                ) VALUES (
                    %(id)s, %(source_cluster_id)s, %(version)s, %(state)s, %(title)s,
                    %(summary)s, %(category)s, %(priority)s, %(severity)s,
                    %(confidence)s, %(location)s, %(latitude)s, %(longitude)s,
                    %(first_reported_at)s, %(last_reported_at)s, %(signal_count)s,
                    %(duplicate_count)s, %(source_mix)s, %(source_signal_ids)s,
                    %(key_facts)s, %(risk_flags)s, %(recommended_actions)s,
                    %(created_at)s, %(updated_at)s
                )
                ON CONFLICT (source_cluster_id) DO UPDATE SET
                    version = EXCLUDED.version,
                    title = EXCLUDED.title,
                    summary = EXCLUDED.summary,
                    priority = EXCLUDED.priority,
                    severity = EXCLUDED.severity,
                    confidence = EXCLUDED.confidence,
                    last_reported_at = EXCLUDED.last_reported_at,
                    signal_count = EXCLUDED.signal_count,
                    duplicate_count = EXCLUDED.duplicate_count,
                    source_mix = EXCLUDED.source_mix,
                    source_signal_ids = EXCLUDED.source_signal_ids,
                    key_facts = EXCLUDED.key_facts,
                    risk_flags = EXCLUDED.risk_flags,
                    recommended_actions = EXCLUDED.recommended_actions,
                    updated_at = EXCLUDED.updated_at
                """,
                self._incident_params(incident),
            )
            event = connection.execute(
                """
                INSERT INTO signal_fusion.outbox_events (
                    event_type, aggregate_id, aggregate_version, payload
                ) VALUES (%s, %s, %s, %s)
                ON CONFLICT (event_type, aggregate_id, aggregate_version)
                DO UPDATE SET payload = EXCLUDED.payload
                RETURNING id
                """,
                (
                    "signal_fusion.incident.promoted.v1",
                    incident["id"],
                    incident["version"],
                    self._json(incident),
                ),
            ).fetchone()
            self._insert_audit(
                connection,
                event_type="cluster_promoted",
                entity_type="cluster",
                entity_id=cluster["id"],
                actor=actor,
                payload={"incident_id": incident["id"], "event_id": event["id"]},
            )
            return int(event["id"])

    def save_merge(
        self,
        source: dict[str, Any],
        target: dict[str, Any],
        signals: list[dict[str, Any]],
        actor: str,
    ) -> None:
        with self._connect() as connection:
            self._upsert_cluster(connection, source)
            self._upsert_cluster(connection, target)
            for signal in signals:
                connection.execute(
                    """
                    UPDATE signal_fusion.signals
                    SET cluster_id = %s, status = %s
                    WHERE id = %s
                    """,
                    (signal["cluster_id"], signal["status"], signal["id"]),
                )
            self._insert_audit(
                connection,
                event_type="clusters_merged",
                entity_type="cluster",
                entity_id=target["id"],
                actor=actor,
                payload={"source_cluster_id": source["id"]},
            )

    def save_split(
        self,
        source: dict[str, Any],
        target: dict[str, Any],
        signals: list[dict[str, Any]],
        actor: str,
        reason: str,
    ) -> None:
        with self._connect() as connection:
            self._upsert_cluster(connection, source)
            self._upsert_cluster(connection, target)
            for signal in signals:
                connection.execute(
                    "UPDATE signal_fusion.signals SET cluster_id = %s, status = %s WHERE id = %s",
                    (signal["cluster_id"], signal["status"], signal["id"]),
                )
            self._insert_audit(
                connection,
                event_type="cluster_split",
                entity_type="cluster",
                entity_id=source["id"],
                actor=actor,
                payload={
                    "created_cluster_id": target["id"],
                    "signal_ids": [item["id"] for item in signals],
                    "reason": reason,
                },
            )

    def get_incident_by_cluster(self, cluster_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM signal_fusion.incident_handoffs WHERE source_cluster_id = %s",
                (cluster_id,),
            ).fetchone()
        return self._incident_from_row(row) if row else None

    def list_incidents(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM signal_fusion.incident_handoffs ORDER BY created_at DESC"
            ).fetchall()
        return [self._incident_from_row(row) for row in rows]

    def list_events(self, after: int, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, event_type, aggregate_id, aggregate_version, payload, created_at
                FROM signal_fusion.outbox_events
                WHERE id > %s ORDER BY id ASC LIMIT %s
                """,
                (after, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_audit(self, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, event_type, entity_type, entity_id, actor, payload, created_at
                FROM signal_fusion.audit_events ORDER BY id DESC LIMIT %s
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def _upsert_cluster(self, connection, cluster: dict[str, Any]) -> None:
        connection.execute(
            """
            INSERT INTO signal_fusion.clusters (
                id, title, summary, category, location, latitude, longitude,
                signal_count, duplicate_count, confidence, severity, priority,
                status, first_seen, last_seen, source_mix, signal_ids, key_facts,
                risk_flags, recommended_actions, incident_id, version, centroid,
                embedding_provider
            ) VALUES (
                %(id)s, %(title)s, %(summary)s, %(category)s, %(location)s,
                %(latitude)s, %(longitude)s, %(signal_count)s, %(duplicate_count)s,
                %(confidence)s, %(severity)s, %(priority)s, %(status)s,
                %(first_seen)s, %(last_seen)s, %(source_mix)s, %(signal_ids)s,
                %(key_facts)s, %(risk_flags)s, %(recommended_actions)s,
                %(incident_id)s, %(version)s, %(centroid)s, %(embedding_provider)s
            )
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                summary = EXCLUDED.summary,
                location = EXCLUDED.location,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                signal_count = EXCLUDED.signal_count,
                duplicate_count = EXCLUDED.duplicate_count,
                confidence = EXCLUDED.confidence,
                severity = EXCLUDED.severity,
                priority = EXCLUDED.priority,
                status = EXCLUDED.status,
                last_seen = EXCLUDED.last_seen,
                source_mix = EXCLUDED.source_mix,
                signal_ids = EXCLUDED.signal_ids,
                key_facts = EXCLUDED.key_facts,
                risk_flags = EXCLUDED.risk_flags,
                recommended_actions = EXCLUDED.recommended_actions,
                incident_id = EXCLUDED.incident_id,
                version = EXCLUDED.version,
                centroid = EXCLUDED.centroid,
                embedding_provider = EXCLUDED.embedding_provider,
                updated_at = NOW()
            """,
            self._cluster_params(cluster),
        )

    def _insert_audit(
        self,
        connection,
        *,
        event_type: str,
        entity_type: str,
        entity_id: str,
        actor: str,
        payload: dict[str, Any],
    ) -> None:
        connection.execute(
            """
            INSERT INTO signal_fusion.audit_events (
                event_type, entity_type, entity_id, actor, payload
            ) VALUES (%s, %s, %s, %s, %s)
            """,
            (event_type, entity_type, entity_id, actor, self._json(payload)),
        )

    def _signal_params(self, signal: dict[str, Any]) -> dict[str, Any]:
        metadata = {
            **signal.get("metadata", {}),
            "_source_confidence": signal.get("source_confidence", 0.7),
            "_evidence_role": signal.get("evidence_role", "corroborating"),
        }
        return {
            **signal,
            "occurred_at": signal.get("observed_at") or signal.get("occurred_at"),
            "metadata": self._json(metadata),
            "embedding": self._json(signal["_embedding"]),
            "embedding_provider": signal["_embedding_provider"],
        }

    def _cluster_params(self, cluster: dict[str, Any]) -> dict[str, Any]:
        return {
            **cluster,
            "source_mix": self._json(cluster["source_mix"]),
            "signal_ids": self._json(cluster["signal_ids"]),
            "key_facts": self._json(cluster["key_facts"]),
            "risk_flags": self._json(cluster["risk_flags"]),
            "recommended_actions": self._json(cluster["recommended_actions"]),
            "centroid": self._json(cluster["_centroid"]),
            "embedding_provider": cluster["_embedding_provider"],
        }

    def _incident_params(self, incident: dict[str, Any]) -> dict[str, Any]:
        return {
            **incident,
            "source_mix": self._json(incident["source_mix"]),
            "source_signal_ids": self._json(incident["source_signal_ids"]),
            "key_facts": self._json(incident["key_facts"]),
            "risk_flags": self._json(incident["risk_flags"]),
            "recommended_actions": self._json(incident["recommended_actions"]),
        }

    def _risk_signal_params(self, risk_signal: dict[str, Any]) -> dict[str, Any]:
        return {**risk_signal, "evidence": self._json(risk_signal["evidence"])}

    def _risk_params(self, risk: dict[str, Any]) -> dict[str, Any]:
        return {**risk, "evidence": self._json(risk["evidence"])}

    @staticmethod
    def _signal_from_row(row: dict[str, Any]) -> dict[str, Any]:
        metadata = row["metadata"] or {}
        return {
            "id": row["id"],
            "external_id": row["external_id"],
            "source": row["source"],
            "caller": row["caller"],
            "transcript": row["transcript"],
            "location": row["location"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "occurred_at": row["occurred_at"],
            "observed_at": row["occurred_at"] or row["received_at"],
            "received_at": row["received_at"],
            "severity": row["severity"],
            "source_confidence": float(metadata.get("_source_confidence", 0.7)),
            "evidence_role": metadata.get("_evidence_role", "corroborating"),
            "status": row["status"],
            "cluster_id": row["cluster_id"],
            "metadata": metadata,
            "_embedding": row["embedding"],
            "_embedding_provider": row["embedding_provider"],
        }

    @staticmethod
    def _cluster_from_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "title": row["title"],
            "summary": row["summary"],
            "category": row["category"],
            "location": row["location"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "signal_count": row["signal_count"],
            "duplicate_count": row["duplicate_count"],
            "confidence": row["confidence"],
            "severity": row["severity"],
            "priority": row["priority"],
            "status": row["status"],
            "first_seen": row["first_seen"],
            "last_seen": row["last_seen"],
            "source_mix": row["source_mix"],
            "signal_ids": row["signal_ids"],
            "key_facts": row["key_facts"],
            "risk_flags": row["risk_flags"],
            "recommended_actions": row["recommended_actions"],
            "incident_id": row["incident_id"],
            "version": row["version"],
            "_centroid": row["centroid"],
            "_embedding_provider": row["embedding_provider"],
        }

    @staticmethod
    def _incident_from_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "source_cluster_id": row["source_cluster_id"],
            "version": row["version"],
            "state": row["state"],
            "title": row["title"],
            "summary": row["summary"],
            "category": row["category"],
            "priority": row["priority"],
            "severity": row["severity"],
            "confidence": row["confidence"],
            "location": row["location"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "first_reported_at": row["first_reported_at"],
            "last_reported_at": row["last_reported_at"],
            "signal_count": row["signal_count"],
            "duplicate_count": row["duplicate_count"],
            "source_mix": row["source_mix"],
            "source_signal_ids": row["source_signal_ids"],
            "key_facts": row["key_facts"],
            "risk_flags": row["risk_flags"],
            "recommended_actions": row["recommended_actions"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _risk_signal_from_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "risk_id": row["risk_id"],
            "external_id": row["external_id"],
            "source": row["source"],
            "zone": row["zone"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "observed_at": row["observed_at"],
            "received_at": row["received_at"],
            "severity": row["severity"],
            "evidence": row["evidence"],
            "validity_minutes": row["validity_minutes"],
        }

    @staticmethod
    def _risk_from_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "zone": row["zone"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "level": row["level"],
            "confidence": row["confidence"],
            "evidence": row["evidence"],
            "recommended_action": row["recommended_action"],
            "generated_at": row["generated_at"],
            "expires_at": row["expires_at"],
            "acknowledged_at": row["acknowledged_at"],
            "acknowledged_by": row["acknowledged_by"],
            "version": row["version"],
        }


class MemoryFusionStore:
    """Test store implementing the PostgreSQL adapter contract without tables."""

    def __init__(self) -> None:
        self._lock = RLock()
        self.signals: dict[str, dict[str, Any]] = {}
        self.clusters: dict[str, dict[str, Any]] = {}
        self.incidents: dict[str, dict[str, Any]] = {}
        self.risk_signals: dict[str, dict[str, Any]] = {}
        self.risks: dict[str, dict[str, Any]] = {}
        self.audit: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []

    def migrate(self) -> None:
        return None

    def ping(self) -> bool:
        return True

    def load_state(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return list(deepcopy(self.signals).values()), list(deepcopy(self.clusters).values())

    def load_risk_state(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return list(deepcopy(self.risk_signals).values()), list(deepcopy(self.risks).values())

    def find_signal_by_external_id(self, external_id: str) -> dict[str, Any] | None:
        return next(
            (deepcopy(item) for item in self.signals.values() if item.get("external_id") == external_id),
            None,
        )

    def find_risk_signal_by_external_id(self, external_id: str) -> dict[str, Any] | None:
        return next(
            (deepcopy(item) for item in self.risk_signals.values() if item.get("external_id") == external_id),
            None,
        )

    def get_risk(self, risk_id: str) -> dict[str, Any] | None:
        risk = self.risks.get(risk_id)
        return deepcopy(risk) if risk else None

    def get_active_risk_by_zone(self, zone: str, now: datetime) -> dict[str, Any] | None:
        matches = [
            item for item in self.risks.values() if item["zone"] == zone and item["expires_at"] > now
        ]
        return deepcopy(max(matches, key=lambda item: item["generated_at"])) if matches else None

    def list_risks(self) -> list[dict[str, Any]]:
        return sorted(
            deepcopy(list(self.risks.values())), key=lambda item: item["generated_at"], reverse=True
        )

    def list_risk_signals(self, zone: str) -> list[dict[str, Any]]:
        return sorted(
            [
                deepcopy(item)
                for item in self.risk_signals.values()
                if item["zone"] == zone
            ],
            key=lambda item: item["observed_at"],
        )

    def save_risk_assessment(self, risk_signal, risk, event_type) -> None:
        with self._lock:
            self.risks[risk["id"]] = deepcopy(risk)
            self.risk_signals[risk_signal["id"]] = deepcopy(risk_signal)
            self._audit(
                "risk_signal_ingested",
                "risk_signal",
                risk_signal["id"],
                "risk-engine",
                {"risk_id": risk["id"], "source": risk_signal["source"]},
            )
            if event_type:
                self._audit(
                    event_type.removeprefix("signal_fusion.").removesuffix(".v1").replace(".", "_"),
                    "risk",
                    risk["id"],
                    "risk-engine",
                    {"level": risk["level"], "version": risk["version"]},
                )
                self.events.append(
                    {
                        "id": len(self.events) + 1,
                        "event_type": event_type,
                        "aggregate_id": risk["id"],
                        "aggregate_version": risk["version"],
                        "payload": deepcopy(risk),
                        "created_at": datetime.now(timezone.utc),
                    }
                )

    def save_risk_refresh(self, risk, event_type) -> None:
        with self._lock:
            self.risks[risk["id"]] = deepcopy(risk)
            if event_type:
                self._audit(
                    event_type.removeprefix("signal_fusion.").removesuffix(".v1").replace(".", "_"),
                    "risk",
                    risk["id"],
                    "risk-engine",
                    {"level": risk["level"], "version": risk["version"]},
                )
                self.events.append(
                    {
                        "id": len(self.events) + 1,
                        "event_type": event_type,
                        "aggregate_id": risk["id"],
                        "aggregate_version": risk["version"],
                        "payload": deepcopy(risk),
                        "created_at": datetime.now(timezone.utc),
                    }
                )

    def acknowledge_risk(self, risk_id, actor, acknowledged_at) -> tuple[dict[str, Any] | None, bool]:
        with self._lock:
            risk = self.risks.get(risk_id)
            if risk is None or risk["expires_at"] <= acknowledged_at or risk["acknowledged_at"]:
                return (deepcopy(risk), False) if risk else (None, False)
            risk = deepcopy(risk)
            risk["acknowledged_at"] = acknowledged_at
            risk["acknowledged_by"] = actor
            risk["version"] += 1
            self.risks[risk["id"]] = deepcopy(risk)
            self._audit(
                "risk_acknowledged",
                "risk",
                risk["id"],
                actor,
                {"level": risk["level"], "version": risk["version"]},
            )
            self.events.append(
                {
                    "id": len(self.events) + 1,
                    "event_type": "signal_fusion.risk.acknowledged.v1",
                    "aggregate_id": risk["id"],
                    "aggregate_version": risk["version"],
                    "payload": deepcopy(risk),
                    "created_at": datetime.now(timezone.utc),
                }
            )
            return deepcopy(risk), True

    def save_ingestion(self, signal, cluster, audit_payload, incident=None) -> None:
        with self._lock:
            self.signals[signal["id"]] = deepcopy(signal)
            self.clusters[cluster["id"]] = deepcopy(cluster)
            self._audit("signal_ingested", "signal", signal["id"], "fusion-engine", audit_payload)
            if incident is not None:
                self.incidents[incident["id"]] = deepcopy(incident)
                self.events.append(
                    {
                        "id": len(self.events) + 1,
                        "event_type": "signal_fusion.incident.updated.v1",
                        "aggregate_id": incident["id"],
                        "aggregate_version": incident["version"],
                        "payload": deepcopy(incident),
                        "created_at": datetime.now(timezone.utc),
                    }
                )

    def save_cluster_action(self, cluster, action, actor) -> None:
        self.clusters[cluster["id"]] = deepcopy(cluster)
        self._audit(f"cluster_{action}", "cluster", cluster["id"], actor, {})

    def save_promotion(self, cluster, incident, actor) -> int:
        self.clusters[cluster["id"]] = deepcopy(cluster)
        self.incidents[incident["id"]] = deepcopy(incident)
        existing = next(
            (item for item in self.events if item["aggregate_id"] == incident["id"]),
            None,
        )
        if existing:
            existing["payload"] = deepcopy(incident)
            return existing["id"]
        event_id = len(self.events) + 1
        self.events.append(
            {
                "id": event_id,
                "event_type": "signal_fusion.incident.promoted.v1",
                "aggregate_id": incident["id"],
                "aggregate_version": incident["version"],
                "payload": deepcopy(incident),
                "created_at": datetime.now(timezone.utc),
            }
        )
        self._audit("cluster_promoted", "cluster", cluster["id"], actor, {"incident_id": incident["id"]})
        return event_id

    def save_merge(self, source, target, signals, actor) -> None:
        self.clusters[source["id"]] = deepcopy(source)
        self.clusters[target["id"]] = deepcopy(target)
        for signal in signals:
            self.signals[signal["id"]] = deepcopy(signal)
        self._audit("clusters_merged", "cluster", target["id"], actor, {"source_cluster_id": source["id"]})

    def save_split(self, source, target, signals, actor, reason) -> None:
        self.clusters[source["id"]] = deepcopy(source)
        self.clusters[target["id"]] = deepcopy(target)
        for signal in signals:
            self.signals[signal["id"]] = deepcopy(signal)
        self._audit(
            "cluster_split",
            "cluster",
            source["id"],
            actor,
            {
                "created_cluster_id": target["id"],
                "signal_ids": [item["id"] for item in signals],
                "reason": reason,
            },
        )

    def get_incident_by_cluster(self, cluster_id: str) -> dict[str, Any] | None:
        return next(
            (deepcopy(item) for item in self.incidents.values() if item["source_cluster_id"] == cluster_id),
            None,
        )

    def list_incidents(self) -> list[dict[str, Any]]:
        return list(reversed(list(deepcopy(self.incidents).values())))

    def list_events(self, after: int, limit: int) -> list[dict[str, Any]]:
        return [deepcopy(item) for item in self.events if item["id"] > after][:limit]

    def list_audit(self, limit: int) -> list[dict[str, Any]]:
        return list(reversed(deepcopy(self.audit)))[:limit]

    def _audit(self, event_type, entity_type, entity_id, actor, payload) -> None:
        self.audit.append(
            {
                "id": len(self.audit) + 1,
                "event_type": event_type,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "actor": actor,
                "payload": deepcopy(payload),
                "created_at": datetime.now(timezone.utc),
            }
        )
