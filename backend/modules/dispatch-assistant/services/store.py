from __future__ import annotations

import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock


DEFAULT_DATABASE_URL = "postgresql://anwar:anwar_local_dev@127.0.0.1:5432/anwar"


class AssistantStorageUnavailable(RuntimeError):
    pass


class PostgresAssistantStore:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
        self.migration_file = Path(__file__).resolve().parents[3] / "infrastructure" / "postgres" / "init" / "005_dispatch_assistant.sql"

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row

            return psycopg.connect(self.database_url, row_factory=dict_row)
        except Exception as exc:
            raise AssistantStorageUnavailable(f"PostgreSQL unavailable: {exc}") from exc

    @staticmethod
    def _json(value: object):
        from psycopg.types.json import Jsonb

        return Jsonb(value, dumps=lambda item: json.dumps(item, default=str))

    def migrate(self) -> None:
        try:
            with self._connect() as connection:
                connection.execute(self.migration_file.read_text(encoding="utf-8"))
        except AssistantStorageUnavailable:
            raise
        except Exception as exc:
            raise AssistantStorageUnavailable(f"Dispatch Assistant migration failed: {exc}") from exc

    def save(self, record: dict) -> dict:
        with self._connect() as connection:
            row = connection.execute(
                """INSERT INTO dispatch_assistant.queries(
                session_id, incident_id, question, intent, answer, sources,
                suggested_actions, limitations
                ) VALUES (%(session_id)s, %(incident_id)s, %(question)s, %(intent)s,
                %(answer)s, %(sources)s, %(suggested_actions)s, %(limitations)s)
                RETURNING *""",
                {
                    **record,
                    "sources": self._json(record["sources"]),
                    "suggested_actions": self._json(record["suggested_actions"]),
                    "limitations": self._json(record["limitations"]),
                },
            ).fetchone()
        return dict(row)

    def session(self, session_id: str, limit: int = 20) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM dispatch_assistant.queries WHERE session_id = %s ORDER BY id DESC LIMIT %s",
                (session_id, limit),
            ).fetchall()
        return [dict(row) for row in reversed(rows)]


class MemoryAssistantStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self.records: list[dict] = []

    def migrate(self) -> None:
        return None

    def save(self, record: dict) -> dict:
        with self._lock:
            row = {"id": len(self.records) + 1, **deepcopy(record), "created_at": datetime.now(timezone.utc)}
            self.records.append(row)
            return deepcopy(row)

    def session(self, session_id: str, limit: int = 20) -> list[dict]:
        with self._lock:
            return deepcopy([item for item in self.records if item["session_id"] == session_id][-limit:])
