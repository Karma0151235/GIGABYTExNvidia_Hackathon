from __future__ import annotations

import math
import os
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from importlib import import_module
from threading import RLock
from time import perf_counter
from typing import Any


semantic = import_module("backend.modules.signal-fusion.services.semantic_provider")
store_module = import_module("backend.modules.signal-fusion.services.store")
SemanticAnalyzer = semantic.SemanticAnalyzer
cosine = semantic.cosine
PostgresFusionStore = store_module.PostgresFusionStore
StorageUnavailable = store_module.StorageUnavailable


class InvalidTransition(ValueError):
    """Raised when an operator attempts an unsafe cluster transition."""


class RiskExpired(ValueError):
    """Raised when an operator attempts to acknowledge an expired forecast."""


class InvalidRiskValidity(ValueError):
    """Raised when a new forecast cannot satisfy the pilot validity window."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    radius = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    value = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(value))


def priority_for(severity: int) -> str:
    if severity >= 90:
        return "P1"
    if severity >= 75:
        return "P2"
    if severity >= 60:
        return "P3"
    return "P4"


class FusionEngine:
    CLUSTER_THRESHOLD = 0.50
    DUPLICATE_THRESHOLD = 0.79
    INCIDENT_DISTANCE_KM = 1.5
    RISK_DISTANCE_KM = 3.0
    INCIDENT_AGE_MINUTES = 15
    RISK_AGE_MINUTES = 45
    PREDICTIVE_SOURCES = {"WEATHER", "TRAFFIC"}
    HUMAN_REPORT_SOURCES = {"CALL", "SMS", "APP"}
    SOURCE_CONFIDENCE = {
        "WEATHER": 0.78, "TRAFFIC": 0.72, "CCTV": 0.68, "CALL": 0.93,
        "FIELD": 0.88, "RADIO": 0.84, "SMS": 0.62, "APP": 0.58,
    }

    RECOMMENDED_ACTIONS = {
        "Road accident": [
            "Dispatch the nearest clinically suitable ambulance",
            "Request traffic control and confirm vehicle access",
            "Screen for entrapment and additional casualties",
        ],
        "Medical": [
            "Dispatch an advanced life support capable unit",
            "Continue caller-assisted first aid instructions",
            "Pre-alert the nearest clinically suitable emergency department",
        ],
        "Hazmat": [
            "Establish a safe approach and exclusion zone",
            "Dispatch fire and hazardous-material support",
            "Confirm wind direction and exposed persons before entry",
        ],
        "Flood": [
            "Avoid submerged road segments and stage on high ground",
            "Request rescue capability for stranded occupants",
            "Monitor water rise and identify a secondary access route",
        ],
        "Public safety": [
            "Confirm scene safety before medical entry",
            "Coordinate police and rescue support",
            "Establish casualty count and safe access point",
        ],
    }

    def __init__(self, store=None, *, seed: bool | None = None) -> None:
        self._lock = RLock()
        self.store = store or PostgresFusionStore()
        self.seed_enabled = (
            seed
            if seed is not None
            else os.getenv("SIGNAL_FUSION_SEED_DEMO", "true").lower() in {"1", "true", "yes"}
        )
        self._signals: dict[str, dict[str, Any]] = {}
        self._clusters: dict[str, dict[str, Any]] = {}
        self._risk_signals: dict[str, dict[str, Any]] = {}
        self._risks: dict[str, dict[str, Any]] = {}
        self._signal_sequence = 8421
        self._cluster_sequence = 2041
        self._incident_sequence = 1001
        self._risk_signal_sequence = 1001
        self._risk_sequence = 1001
        self._last_latency_ms = 0
        self._ready = False
        self.analyzer = SemanticAnalyzer()

    def _ensure_ready(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            self.store.migrate()
            signals, clusters = self.store.load_state()
            risk_signals, risks = self.store.load_risk_state()
            self._signals = {item["id"]: item for item in signals}
            self._clusters = {item["id"]: item for item in clusters}
            self._risk_signals = {item["id"]: item for item in risk_signals}
            self._risks = {item["id"]: item for item in risks}
            self._restore_sequences()
            self._ready = True
            if self.seed_enabled and "CL-ORACLE-001" not in self._clusters:
                self._seed()

    def _restore_sequences(self) -> None:
        self._signal_sequence = self._next_sequence(self._signals, "SIG", 8421)
        self._cluster_sequence = self._next_sequence(self._clusters, "CLU", 2041)
        incidents = self.store.list_incidents()
        self._incident_sequence = self._next_sequence(
            {item["id"]: item for item in incidents}, "INC", 1001
        )
        self._risk_signal_sequence = self._next_sequence(self._risk_signals, "RSG", 1001)
        self._risk_sequence = self._next_sequence(self._risks, "RSK", 1001)

    @staticmethod
    def _next_sequence(items: dict[str, Any], prefix: str, baseline: int) -> int:
        values = []
        for identifier in items:
            try:
                if identifier.startswith(f"{prefix}-"):
                    values.append(int(identifier.split("-", 1)[1]))
            except ValueError:
                continue
        return max([baseline - 1, *values]) + 1

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
            **self.diagnostics(),
        }

    def diagnostics(self) -> dict[str, Any]:
        return {
            **self.analyzer.diagnostics(),
            "cluster_threshold": self.CLUSTER_THRESHOLD,
            "duplicate_threshold": self.DUPLICATE_THRESHOLD,
            "incident_radius_km": self.INCIDENT_DISTANCE_KM,
            "risk_radius_km": self.RISK_DISTANCE_KM,
            "incident_window_minutes": self.INCIDENT_AGE_MINUTES,
            "cluster_count": len(self._clusters),
            "ready": self._ready,
        }

    def _seed(self) -> None:
        base = utcnow() - timedelta(minutes=12)
        scenario = [
            ("RSK-RAIN-001", "WEATHER", 0, 84, 0.78, "Rainfall intensity increased to 48 mm/hour. Local drainage capacity at 91%.", "Bukit Bintang", "early_warning", 48, "Monitor"),
            ("RSK-TRAFFIC-001", "TRAFFIC", 2, 76, 0.72, "Average road speed on Jalan Sultan Ismail dropped 58% below normal for this time.", "Bukit Bintang", "early_warning", 63, "Staged"),
            ("CCTV-INC-001", "CCTV", 5, 82, 0.68, "Two stationary vehicles and debris detected near Jalan Sultan Ismail; visibility reduced by heavy rain.", "Bukit Bintang", "corroborating", 77, "Awaiting Review"),
            ("CALL-999-001", "CALL", 8, 96, 0.93, "Hello 999, dekat Bukit Bintang, kereta langgar motor. Rider tak bergerak, hujan lebat sangat, banyak traffic.", "Bukit Bintang / Jalan Sultan Ismail", "primary_report", 90, "Incident Ready"),
            ("FIELD-EMS-001", "FIELD", 10, 90, 0.88, "Patrol confirms motorcycle rider down, one lane blocked, ambulance access delayed by standing water.", "Jalan Sultan Ismail", "corroborating", 94, "Incident Ready"),
        ]
        callers = {
            "WEATHER": "MET Malaysia / drainage telemetry",
            "TRAFFIC": "KL traffic anomaly feed",
            "CCTV": "DBKL CCTV analytics",
            "CALL": "MERS 999 caller",
            "FIELD": "EMS patrol radio",
        }
        for index, item in enumerate(scenario):
            signal_id, source, offset, severity, source_confidence, transcript, location, role, checkpoint, action_state = item
            observed_at = base + timedelta(minutes=offset)
            self._ingest_ready(
                {
                    "_signal_id": signal_id,
                    "_cluster_id": "CL-ORACLE-001" if index == 0 else None,
                    "source": source,
                    "external_id": signal_id,
                    "caller": callers[source],
                    "transcript": transcript,
                    "location": location,
                    "latitude": 3.1468 + (index - 2) * 0.00012,
                    "longitude": 101.7113 + (index - 2) * 0.00011,
                    "observed_at": observed_at,
                    "occurred_at": observed_at,
                    "severity": severity,
                    "source_confidence": source_confidence,
                    "evidence_role": role,
                    "metadata": {
                        "seed": True,
                        "scenario": "predictive-oracle",
                        "confidence_checkpoint": checkpoint,
                        "action_state": action_state,
                        "cluster_title": "Possible flood-related multi-vehicle collision",
                        "audio_url": (
                            "data:audio/wav;base64,"
                            "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
                            if source == "CALL" else ""
                        ),
                        "extracted_facts": "one possible unconscious patient; road collision; heavy rain; Bukit Bintang" if source == "CALL" else "",
                    },
                },
                observed_at,
            )

    def _best_cluster(
        self, signal: dict[str, Any]
    ) -> tuple[dict[str, Any] | None, float, float, float | None]:
        best, best_score, best_semantic, best_distance = None, 0.0, 0.0, None
        now = signal["received_at"]
        for cluster in self._clusters.values():
            if cluster["status"] == "dismissed":
                continue
            age_minutes = max(0.0, (now - cluster["last_seen"]).total_seconds() / 60)
            distance = haversine_km(
                signal["latitude"],
                signal["longitude"],
                cluster["latitude"],
                cluster["longitude"],
            )
            predictive_cluster = bool(self.PREDICTIVE_SOURCES.intersection(cluster["source_mix"]))
            broad_match = signal["source"] in self.PREDICTIVE_SOURCES or predictive_cluster
            max_distance = self.RISK_DISTANCE_KM if signal["source"] in self.PREDICTIVE_SOURCES else self.INCIDENT_DISTANCE_KM
            max_age = self.RISK_AGE_MINUTES if broad_match else self.INCIDENT_AGE_MINUTES
            if distance > max_distance or age_minutes > max_age:
                continue
            semantic_score = max(0.0, cosine(signal["_embedding"], cluster["_centroid"]))
            if predictive_cluster and distance <= self.INCIDENT_DISTANCE_KM and age_minutes <= self.INCIDENT_AGE_MINUTES:
                semantic_score = max(semantic_score, 0.5)
            if signal["source"] in self.PREDICTIVE_SOURCES and distance <= self.RISK_DISTANCE_KM:
                semantic_score = max(semantic_score, 0.52)
            geo_score = max(0.0, 1 - distance / max_distance)
            recency_score = max(0.0, 1 - age_minutes / max_age)
            diversity_score = 1.0 if signal["source"] not in cluster["source_mix"] else 0.2
            score = semantic_score * 0.50 + geo_score * 0.25 + recency_score * 0.15 + diversity_score * 0.10
            if score > best_score:
                best, best_score, best_semantic, best_distance = (
                    cluster,
                    score,
                    semantic_score,
                    distance,
                )
        return best, best_score, best_semantic, best_distance

    def ingest(self, payload: dict[str, Any], received_at: datetime | None = None) -> dict[str, Any]:
        """Backward-compatible report endpoint returning only the stored signal."""
        return self.ingest_report(payload, received_at)["signal"]

    def ingest_report(
        self, payload: dict[str, Any], received_at: datetime | None = None
    ) -> dict[str, Any]:
        self._ensure_ready()
        with self._lock:
            return self._ingest_ready(payload, received_at)

    def _sync_predictive_risk(self, payload: dict[str, Any], received_at: datetime) -> None:
        source = payload.get("source")
        if source not in self.PREDICTIVE_SOURCES:
            return
        observed_at = payload.get("observed_at") or payload.get("occurred_at") or received_at
        try:
            self.ingest_risk_signal(
                {
                    "source": "rainfall" if source == "WEATHER" else "congestion",
                    "external_id": f"risk::{payload.get('external_id')}" if payload.get("external_id") else None,
                    "zone": payload["location"],
                    "latitude": payload["latitude"],
                    "longitude": payload["longitude"],
                    "observed_at": observed_at,
                    "severity": payload.get("severity") or 60,
                    "evidence": {
                        "summary": payload["transcript"],
                        "source_confidence": payload.get("source_confidence") or self.SOURCE_CONFIDENCE[source],
                    },
                    "validity_minutes": 60,
                },
                now=received_at,
            )
        except (InvalidRiskValidity, RiskExpired):
            # The raw signal remains valuable even if its forecast validity window is stale.
            return

    def _ingest_ready(
        self, payload: dict[str, Any], received_at: datetime | None = None
    ) -> dict[str, Any]:
        started = perf_counter()
        external_id = payload.get("external_id")
        if external_id:
            existing = self.store.find_signal_by_external_id(external_id)
            if existing:
                cluster = self._clusters[existing["cluster_id"]]
                latency = max(1, round((perf_counter() - started) * 1000))
                return {
                    "signal": self._public(existing),
                    "cluster": self._public(cluster),
                    "decision": {
                        "outcome": "replayed",
                        "reason": "The external report ID was already processed; the original result was returned.",
                        "cluster_id": cluster["id"],
                        "cluster_created": False,
                        "fusion_score": 1.0,
                        "semantic_score": 1.0,
                        "distance_km": 0.0,
                        "provider": self.analyzer.provider.name,
                    },
                    "processing_latency_ms": latency,
                }

        effective_received_at = received_at or utcnow()
        self._sync_predictive_risk(payload, effective_received_at)
        analysis = self.analyzer.analyze(payload["transcript"], payload["location"])
        signal_id = payload.get("_signal_id") or f"SIG-{self._signal_sequence}"
        if not payload.get("_signal_id"):
            self._signal_sequence += 1
        source = payload.get("source", "CALL")
        source_confidence = payload.get("source_confidence") or self.SOURCE_CONFIDENCE.get(source, 0.65)
        evidence_role = payload.get("evidence_role") or (
            "early_warning" if source in self.PREDICTIVE_SOURCES
            else "primary_report" if source == "CALL"
            else "corroborating"
        )
        signal = {
            "source": source,
            "external_id": external_id,
            "caller": payload.get("caller") or "Anonymous / unknown",
            "transcript": payload["transcript"],
            "location": payload["location"],
            "latitude": payload["latitude"],
            "longitude": payload["longitude"],
            "observed_at": payload.get("observed_at") or payload.get("occurred_at") or effective_received_at,
            "occurred_at": payload.get("occurred_at") or payload.get("observed_at"),
            "metadata": payload.get("metadata", {}),
            "id": signal_id,
            "received_at": effective_received_at,
            "severity": payload.get("severity") if payload.get("severity") is not None else analysis.severity,
            "source_confidence": source_confidence,
            "evidence_role": evidence_role,
            "status": "new",
            "cluster_id": None,
            "_embedding": analysis.vector,
            "_embedding_provider": self.analyzer.provider.name,
        }
        cluster, fusion_score, semantic_score, distance = self._best_cluster(signal)
        cluster_created = cluster is None or fusion_score < self.CLUSTER_THRESHOLD
        if cluster_created:
            cluster_id = payload.get("_cluster_id") or f"CLU-{self._cluster_sequence}"
            if not payload.get("_cluster_id"):
                self._cluster_sequence += 1
            cluster = {
                "id": cluster_id,
                "title": payload.get("metadata", {}).get("cluster_title") or analysis.title,
                "summary": payload["transcript"],
                "category": analysis.category,
                "location": payload["location"],
                "latitude": payload["latitude"],
                "longitude": payload["longitude"],
                "signal_count": 0,
                "duplicate_count": 0,
                "confidence": payload.get("metadata", {}).get("confidence_checkpoint") or max(48, round(55 + analysis.confidence * 55)),
                "severity": signal["severity"],
                "priority": priority_for(signal["severity"]),
                "status": "emerging",
                "first_seen": signal["received_at"],
                "last_seen": signal["received_at"],
                "source_mix": {},
                "signal_ids": [],
                "key_facts": [],
                "risk_flags": self._oracle_flags(
                    payload["latitude"], payload["longitude"], signal["received_at"]
                ),
                "recommended_actions": [],
                "incident_id": None,
                "version": 1,
                "_centroid": analysis.vector,
                "_embedding_provider": self.analyzer.provider.name,
            }
        else:
            cluster = deepcopy(cluster)
            cluster_id = cluster["id"]

        is_duplicate = (
            not cluster_created
            and signal["source"] in self.HUMAN_REPORT_SOURCES
            and semantic_score >= self.DUPLICATE_THRESHOLD
            and fusion_score >= 0.74
        )
        signal["status"] = "duplicate" if is_duplicate else "correlated"
        if is_duplicate:
            signal["evidence_role"] = "duplicate_report"
        signal["cluster_id"] = cluster_id
        old_count = cluster["signal_count"]
        source_was_new = signal["source"] not in cluster["source_mix"]
        cluster["signal_count"] += 1
        cluster["duplicate_count"] += int(is_duplicate)
        checkpoint = signal["metadata"].get("confidence_checkpoint")
        cluster["confidence"] = int(checkpoint) if checkpoint is not None else min(
            99,
            max(
                cluster["confidence"],
                round(
                    cluster["confidence"]
                    + (11 if source_was_new else 4)
                    * signal["source_confidence"]
                ),
            ),
        )
        cluster["severity"] = max(cluster["severity"], signal["severity"])
        cluster["priority"] = priority_for(cluster["severity"])
        cluster["last_seen"] = signal["received_at"]
        cluster["source_mix"][signal["source"]] = cluster["source_mix"].get(signal["source"], 0) + 1
        cluster["signal_ids"].append(signal_id)
        if old_count:
            cluster["_centroid"] = [
                (old * old_count + new) / cluster["signal_count"]
                for old, new in zip(cluster["_centroid"], analysis.vector)
            ]
            cluster["latitude"] = (
                cluster["latitude"] * old_count + signal["latitude"]
            ) / cluster["signal_count"]
            cluster["longitude"] = (
                cluster["longitude"] * old_count + signal["longitude"]
            ) / cluster["signal_count"]
            cluster["version"] += 1
        self._refresh_operator_brief(cluster, signal)
        if (
            signal["source"] == "CALL"
            and cluster["priority"] == "P1"
            and self.PREDICTIVE_SOURCES.intersection(cluster["source_mix"])
            and cluster["status"] == "emerging"
        ):
            cluster["status"] = "verified"

        incident = None
        if cluster["status"] == "promoted" and cluster.get("incident_id"):
            existing_incident = self.store.get_incident_by_cluster(cluster["id"])
            incident = self._build_incident(cluster, existing_incident)

        audit_payload = {
            "cluster_id": cluster_id,
            "fusion_score": round(fusion_score, 4),
            "semantic_score": round(semantic_score, 4),
            "distance_km": round(distance, 3) if distance is not None else None,
            "duplicate": is_duplicate,
            "cluster_created": cluster_created,
            "provider": self.analyzer.provider.name,
        }
        self.store.save_ingestion(signal, cluster, audit_payload, incident)
        self._signals[signal_id] = signal
        self._clusters[cluster_id] = cluster
        latency = max(1, round((perf_counter() - started) * 1000))
        self._last_latency_ms = latency
        outcome = "new_cluster" if cluster_created else "duplicate" if is_duplicate else "correlated"
        reason = {
            "new_cluster": "No active event crossed the semantic, distance, and recency threshold.",
            "duplicate": "A near-identical human report was suppressed from the queue and retained as duplicate evidence.",
            "correlated": "The report adds distinct evidence to an existing nearby event.",
        }[outcome]
        return {
            "signal": self._public(signal),
            "cluster": self._public(cluster),
            "decision": {
                "outcome": outcome,
                "reason": reason,
                "cluster_id": cluster_id,
                "cluster_created": cluster_created,
                "fusion_score": round(fusion_score, 4),
                "semantic_score": round(semantic_score, 4),
                "distance_km": round(distance, 3) if distance is not None else None,
                "provider": self.analyzer.provider.name,
            },
            "processing_latency_ms": latency,
        }

    def _refresh_operator_brief(self, cluster: dict[str, Any], signal: dict[str, Any]) -> None:
        if cluster["signal_count"] > 1:
            cluster["summary"] = (
                f"{cluster['signal_count']} correlated reports from "
                f"{len(cluster['source_mix'])} channel(s) indicate "
                f"{cluster['title'].lower()} around {cluster['location']}. "
                f"Latest verified detail: {signal['transcript']}"
            )
        cluster["key_facts"] = [
            f"{cluster['signal_count']} report(s) across {len(cluster['source_mix'])} channel(s)",
            f"Latest location: {cluster['location']}",
            f"{cluster['duplicate_count']} probable duplicate(s) retained as evidence",
            f"Fusion confidence {cluster['confidence']}% with severity {cluster['severity']}/100",
        ]
        # Oracle affirmation stamps are set at cluster birth and must survive rebuilds
        flags = [flag for flag in cluster["risk_flags"] if flag.startswith("Oracle ")]
        if cluster["severity"] >= 90:
            flags.append("Immediate life-safety risk")
        if cluster["duplicate_count"] >= 2:
            flags.append("Multiple corroborating reports")
        if len(cluster["source_mix"]) >= 2:
            flags.append("Cross-channel confirmation")
        if cluster["category"] in {"Hazmat", "Flood"}:
            flags.append("Scene access may be unsafe")
        cluster["risk_flags"] = flags
        cluster["recommended_actions"] = list(self.RECOMMENDED_ACTIONS[cluster["category"]])

    def _cluster_evidence(self, cluster: dict[str, Any]) -> list[dict[str, Any]]:
        return sorted(
            [self._signals[item_id] for item_id in cluster["signal_ids"] if item_id in self._signals],
            key=lambda item: item.get("observed_at") or item["received_at"],
        )

    def _decorate_cluster(
        self, cluster: dict[str, Any], at: datetime | None = None
    ) -> dict[str, Any]:
        result = {key: value for key, value in cluster.items() if not key.startswith("_")}
        evidence = self._cluster_evidence(cluster)
        now = at or utcnow()
        calls = [item for item in evidence if item["source"] == "CALL"]
        first_call_at = (
            min(item.get("observed_at") or item["received_at"] for item in calls)
            if calls else None
        )
        first_seen = min(
            [item.get("observed_at") or item["received_at"] for item in evidence],
            default=cluster["first_seen"],
        )
        lead_time = (
            max(0, round((first_call_at - first_seen).total_seconds() / 60))
            if first_call_at else None
        )
        distinct_sources = {item["source"] for item in evidence}
        checkpoints = [
            {
                "at": item.get("observed_at") or item["received_at"],
                "confidence": int(item["metadata"]["confidence_checkpoint"]),
                "source": item["source"],
                "action": item["metadata"].get("action_state", "Monitor"),
            }
            for item in evidence
            if item.get("metadata", {}).get("confidence_checkpoint") is not None
        ]
        latest_at = max(
            [item.get("observed_at") or item["received_at"] for item in evidence],
            default=cluster["last_seen"],
        )
        age_since_latest = max(0, (now - latest_at).total_seconds() / 60)
        trend = "decaying" if age_since_latest > 20 else "rising" if len(distinct_sources) >= 2 else "stable"
        risk = next(
            (
                item for item in self._risks.values()
                if item["generated_at"] <= (first_call_at or now)
                and haversine_km(
                    cluster["latitude"], cluster["longitude"], item["latitude"], item["longitude"]
                ) <= self.RISK_DISTANCE_KM
            ),
            None,
        )
        action_state = (
            evidence[-1].get("metadata", {}).get("action_state")
            if evidence else None
        ) or (
            "Incident Ready" if first_call_at and cluster["priority"] == "P1"
            else "Awaiting Review" if first_call_at
            else "Staged" if cluster["confidence"] >= 60
            else "Monitor"
        )
        if first_call_at and cluster["priority"] == "P1":
            recommended_action = (
                "Confirm route diversion and Hospital Kuala Lumpur pre-alert."
                if "FIELD" in distinct_sources
                else "Dispatch nearest trauma-capable ambulance; notify Hospital Kuala Lumpur ED."
            )
        elif {"WEATHER", "TRAFFIC"}.issubset(distinct_sources):
            recommended_action = "Stage nearest ambulance for operator review; continue monitoring."
        else:
            recommended_action = "Monitor for independent corroboration."
        if any(flag.startswith("Operator override:") for flag in cluster["risk_flags"]):
            recommended_action = cluster["recommended_actions"][0]
        if cluster["id"] == "CL-ORACLE-001":
            result["summary"] = (
                "Five independent operational signals indicate a flood-related multi-vehicle "
                "collision near Jalan Sultan Ismail. A possible unconscious motorcycle rider "
                "is reported, one lane is blocked, and standing water may delay ambulance access."
            )
            confidence_explanation = (
                "94% confidence: one P1 call, CCTV confirmation, field confirmation, abnormal "
                "traffic, and severe rainfall all overlap within 0.6 km and 10 minutes."
            )
        else:
            source_text = ", ".join(sorted(source.title() for source in distinct_sources))
            confidence_explanation = (
                f"{cluster['confidence']}% confidence from {len(evidence)} retained signal(s) "
                f"across {len(distinct_sources)} independent source type(s): {source_text}."
            )
        result.update(
            correlated_count=max(0, len(evidence) - len(calls) - cluster["duplicate_count"]),
            evidence_count=len(evidence),
            independent_sources=len(distinct_sources),
            first_call_at=first_call_at,
            lead_time_minutes=lead_time,
            sla_started_at=first_call_at,
            sla_seconds_elapsed=(
                max(0, round((now - first_call_at).total_seconds())) if first_call_at else None
            ),
            confidence_trend=trend,
            confidence_history=checkpoints or [{
                "at": latest_at,
                "confidence": cluster["confidence"],
                "source": evidence[-1]["source"] if evidence else "UNKNOWN",
                "action": action_state,
            }],
            action_state=action_state,
            recommended_action=recommended_action,
            risk_zone_id=risk["id"] if risk else None,
            confidence_explanation=confidence_explanation,
        )
        return result

    def _public(self, item: dict[str, Any]) -> dict[str, Any]:
        if "signal_ids" in item:
            return self._decorate_cluster(item)
        return {key: value for key, value in item.items() if not key.startswith("_")}

    @staticmethod
    def _risk_level(signals: list[dict[str, Any]]) -> str:
        severity_by_source = {
            source: max(item["severity"] for item in signals if item["source"] == source)
            for source in {item["source"] for item in signals}
        }
        rainfall = severity_by_source.get("rainfall", 0)
        congestion = severity_by_source.get("congestion", 0)
        event = severity_by_source.get("event", 0)
        field = severity_by_source.get("field", 0)
        maximum = max(severity_by_source.values())
        if field >= 90 or (rainfall >= 85 and congestion >= 70 and maximum >= 90):
            return "critical"
        if (rainfall >= 70 and congestion >= 50) or field >= 75 or (event >= 80 and congestion >= 60):
            return "high"
        if maximum >= 60 or len(severity_by_source) >= 2:
            return "medium"
        return "low"

    @staticmethod
    def _risk_confidence(signals: list[dict[str, Any]]) -> int:
        sources = len({item["source"] for item in signals})
        maximum = max(item["severity"] for item in signals)
        return min(95, 40 + sources * 15 + min(15, len(signals) * 5) + maximum // 5)

    @staticmethod
    def _risk_action(level: str) -> str:
        return {
            "low": "monitor",
            "medium": "notify",
            "high": "stage_unit",
            "critical": "alert_hospital",
        }[level]

    def _active_risk_evidence(
        self, zone: str, now: datetime, risk_id: str | None = None
    ) -> list[dict[str, Any]]:
        return [
            signal
            for signal in self.store.list_risk_signals(zone)
            if (risk_id is None or signal["risk_id"] == risk_id)
            and signal["observed_at"] + timedelta(minutes=signal["validity_minutes"]) > now
        ]

    def _refresh_risk(self, risk: dict[str, Any], now: datetime) -> dict[str, Any] | None:
        evidence = self._active_risk_evidence(risk["zone"], now, risk["id"])
        if not evidence:
            return None
        refreshed = deepcopy(risk)
        level = self._risk_level(evidence)
        level_changed = level != risk["level"]
        refreshed.update(
            level=level,
            confidence=self._risk_confidence(evidence),
            evidence=evidence,
            recommended_action=self._risk_action(level),
            expires_at=max(
                signal["observed_at"] + timedelta(minutes=signal["validity_minutes"])
                for signal in evidence
            ),
        )
        if level_changed:
            refreshed["version"] += 1
            refreshed["acknowledged_at"] = None
            refreshed["acknowledged_by"] = None
        changed = level_changed or any(
            refreshed[field] != risk[field]
            for field in ("confidence", "recommended_action", "expires_at")
        ) or [signal["id"] for signal in evidence] != [
            signal["id"] for signal in risk["evidence"]
        ]
        if changed:
            self.store.save_risk_refresh(
                refreshed,
                "signal_fusion.risk.level_changed.v1" if level_changed else None,
            )
            self._risks[refreshed["id"]] = deepcopy(refreshed)
        return refreshed

    def ingest_risk_signal(
        self, payload: dict[str, Any], now: datetime | None = None
    ) -> dict[str, Any]:
        """Assess local scenario evidence; expired external IDs return a 409 rather than stale data."""
        self._ensure_ready()
        with self._lock:
            now = now or utcnow()
            external_id = payload.get("external_id")
            if external_id:
                existing = self.store.find_risk_signal_by_external_id(external_id)
                if existing:
                    risk = self.store.get_risk(existing["risk_id"])
                    if (
                        risk is None
                        or risk["expires_at"] <= now
                        or existing["observed_at"] + timedelta(minutes=existing["validity_minutes"]) <= now
                    ):
                        raise RiskExpired("Expired risk signals cannot be replayed")
                    risk = self._refresh_risk(risk, now)
                    if risk is None:
                        raise RiskExpired("Expired risk signals cannot be replayed")
                    return {
                        "risk_signal": existing,
                        "risk": risk,
                        "replayed": True,
                    }
            remaining = payload["observed_at"] + timedelta(minutes=payload.get("validity_minutes", 45)) - now
            if not timedelta(minutes=30) <= remaining <= timedelta(minutes=60):
                raise InvalidRiskValidity("Risk signals require 30 to 60 minutes of remaining validity")
            active = self.store.get_active_risk_by_zone(payload["zone"], now)
            risk_id = active["id"] if active else f"RSK-{self._risk_sequence}"
            if active is None:
                self._risk_sequence += 1
            risk_signal = {
                "id": f"RSG-{self._risk_signal_sequence}",
                "risk_id": risk_id,
                "external_id": external_id,
                "source": payload["source"],
                "zone": payload["zone"],
                "latitude": payload["latitude"],
                "longitude": payload["longitude"],
                "observed_at": payload["observed_at"],
                "received_at": now,
                "severity": payload["severity"],
                "evidence": payload.get("evidence", {}),
                "validity_minutes": payload.get("validity_minutes", 45),
            }
            self._risk_signal_sequence += 1
            evidence = self._active_risk_evidence(risk_signal["zone"], now) + [risk_signal]
            level = self._risk_level(evidence)
            level_changed = bool(active and active["level"] != level)
            risk = {
                "id": risk_id,
                "zone": risk_signal["zone"],
                "latitude": risk_signal["latitude"],
                "longitude": risk_signal["longitude"],
                "level": level,
                "confidence": self._risk_confidence(evidence),
                "evidence": evidence,
                "recommended_action": self._risk_action(level),
                "generated_at": active["generated_at"] if active else now,
                "expires_at": max(
                    signal["observed_at"] + timedelta(minutes=signal["validity_minutes"])
                    for signal in evidence
                ),
                "acknowledged_at": None if active is None or level_changed else active["acknowledged_at"],
                "acknowledged_by": None if active is None or level_changed else active["acknowledged_by"],
                "version": 1 if active is None else active["version"] + int(level_changed),
            }
            event_type = (
                "signal_fusion.risk.assessed.v1"
                if active is None
                else "signal_fusion.risk.level_changed.v1"
                if level_changed
                else None
            )
            self.store.save_risk_assessment(risk_signal, risk, event_type)
            self._risk_signals[risk_signal["id"]] = deepcopy(risk_signal)
            self._risks[risk["id"]] = deepcopy(risk)
            return {"risk_signal": risk_signal, "risk": risk, "replayed": False}

    ORACLE_RADIUS_KM = 3.0

    def _oracle_flags(self, latitude: float, longitude: float, at: datetime) -> list[str]:
        """Affirmation stamp: a new cluster born inside an active risk zone was anticipated."""
        flags = []
        for risk in self._risks.values():
            if risk["expires_at"] <= at:
                continue
            distance = haversine_km(latitude, longitude, risk["latitude"], risk["longitude"])
            if distance > self.ORACLE_RADIUS_KM:
                continue
            lead_minutes = max(0, round((at - risk["generated_at"]).total_seconds() / 60))
            flags.append(
                f"Oracle {risk['id']}: {risk['zone']} {risk['level']} risk flagged "
                f"{lead_minutes} min before first report ({distance:.1f} km)"
            )
        return flags

    def list_risks(self, now: datetime | None = None) -> list[dict[str, Any]]:
        self._ensure_ready()
        at = now or utcnow()
        active = []
        with self._lock:
            for risk in self.store.list_risks():
                if risk["expires_at"] <= at:
                    continue
                refreshed = self._refresh_risk(risk, at)
                if refreshed and refreshed["expires_at"] > at:
                    active.append(self._decorate_risk(refreshed, at))
        return active

    def _decorate_risk(self, risk: dict[str, Any], at: datetime) -> dict[str, Any]:
        result = deepcopy(risk)
        evidence = risk.get("evidence", [])
        latest = max(
            [item["observed_at"] for item in evidence],
            default=risk["generated_at"],
        )
        candidates = [
            cluster for cluster in self._clusters.values()
            if haversine_km(
                cluster["latitude"], cluster["longitude"], risk["latitude"], risk["longitude"]
            ) <= self.RISK_DISTANCE_KM
            and any(
                self._signals.get(signal_id, {}).get("source") == "CALL"
                for signal_id in cluster["signal_ids"]
            )
        ]
        predictive_candidates = [
            cluster for cluster in candidates
            if self.PREDICTIVE_SOURCES.intersection(cluster["source_mix"])
        ]
        linked_cluster = min(
            predictive_candidates or candidates,
            key=lambda cluster: haversine_km(
                cluster["latitude"], cluster["longitude"], risk["latitude"], risk["longitude"]
            ),
            default=None,
        )
        minutes_stale = max(0, (at - latest).total_seconds() / 60)
        result.update(
            radius_km=self.RISK_DISTANCE_KM,
            status=(
                "incident_linked" if linked_cluster
                else "acknowledged" if risk.get("acknowledged_at")
                else "watching"
            ),
            confidence_trend="decaying" if minutes_stale > 20 else "rising" if len(evidence) > 1 else "stable",
            latest_evidence_at=latest,
            linked_cluster_id=linked_cluster["id"] if linked_cluster else None,
            summary=(
                f"{len(evidence)} weak signal(s) overlap around {risk['zone']}; "
                f"current preparation posture is {risk['recommended_action'].replace('_', ' ')}."
            ),
        )
        return result

    def acknowledge_risk(self, risk_id: str, actor: str = "console-operator") -> dict[str, Any]:
        self._ensure_ready()
        with self._lock:
            now = utcnow()
            current = self.store.get_risk(risk_id)
            if current is None:
                raise KeyError(risk_id)
            current = self._refresh_risk(current, now)
            if current is None or current["expires_at"] <= now:
                raise RiskExpired("Expired forecasts cannot be acknowledged")
            risk, acknowledged = self.store.acknowledge_risk(risk_id, actor, now)
            if risk is None:
                raise KeyError(risk_id)
            if risk["expires_at"] <= now:
                raise RiskExpired("Expired forecasts cannot be acknowledged")
            if not acknowledged:
                return risk
            self._risks[risk_id] = deepcopy(risk)
            return risk

    def snapshot(self) -> dict[str, Any]:
        self._ensure_ready()
        with self._lock:
            signals = sorted(
                self._signals.values(), key=lambda item: item["received_at"], reverse=True
            )
            clusters = sorted(
                self._clusters.values(),
                key=lambda item: (
                    item["status"] == "dismissed",
                    -item["severity"],
                    -item["confidence"],
                ),
            )
            today = utcnow().date()
            today_signals = [item for item in signals if item["received_at"].date() == today]
            duplicates = sum(item["status"] == "duplicate" for item in today_signals)
            active = sum(item["status"] in {"emerging", "verified"} for item in clusters)
            confidence = round(
                sum(item["confidence"] for item in clusters) / max(1, len(clusters)), 1
            )
            incidents_ready = sum(
                item["status"] == "promoted"
                or (item["status"] == "verified" and item["priority"] == "P1")
                for item in clusters
            )
            return {
                "generated_at": utcnow(),
                "stats": {
                    "signals_today": len(today_signals),
                    "active_clusters": active,
                    "duplicates_removed": duplicates,
                    "reduction_rate": round(duplicates / max(1, len(today_signals)) * 100, 1),
                    "average_confidence": confidence,
                    "processing_latency_ms": self._last_latency_ms,
                    "incidents_ready": incidents_ready,
                },
                "signals": [self._public(item) for item in signals[:100]],
                "clusters": [self._public(item) for item in clusters],
                "risks": self.list_risks(),
                "audit_events": self.store.list_audit(50),
            }

    def override_recommendation(
        self,
        cluster_id: str,
        recommended_action: str,
        reason: str,
        actor: str = "console-operator",
    ) -> dict[str, Any]:
        self._ensure_ready()
        with self._lock:
            cluster = deepcopy(self._get_cluster(cluster_id))
            cluster["recommended_actions"] = [
                recommended_action,
                *cluster["recommended_actions"][1:],
            ]
            cluster["risk_flags"] = [
                *[flag for flag in cluster["risk_flags"] if not flag.startswith("Operator override:")],
                f"Operator override: {reason}",
            ]
            cluster["version"] += 1
            self.store.save_cluster_action(cluster, "override", actor)
            self._clusters[cluster_id] = cluster
            result = self._public(cluster)
            result["recommended_action"] = recommended_action
            return result

    def _rebuild_cluster(
        self, cluster: dict[str, Any], signal_ids: list[str]
    ) -> dict[str, Any]:
        signals = [self._signals[item_id] for item_id in signal_ids]
        rebuilt = deepcopy(cluster)
        rebuilt["signal_ids"] = list(signal_ids)
        rebuilt["signal_count"] = len(signals)
        rebuilt["duplicate_count"] = sum(item["status"] == "duplicate" for item in signals)
        rebuilt["source_mix"] = {}
        for signal in signals:
            rebuilt["source_mix"][signal["source"]] = rebuilt["source_mix"].get(signal["source"], 0) + 1
        rebuilt["latitude"] = sum(item["latitude"] for item in signals) / len(signals)
        rebuilt["longitude"] = sum(item["longitude"] for item in signals) / len(signals)
        rebuilt["first_seen"] = min(item["received_at"] for item in signals)
        rebuilt["last_seen"] = max(item["received_at"] for item in signals)
        rebuilt["severity"] = max(item["severity"] for item in signals)
        rebuilt["priority"] = priority_for(rebuilt["severity"])
        rebuilt["confidence"] = max(
            45,
            max(
                [
                    int(item.get("metadata", {}).get("confidence_checkpoint", 0))
                    for item in signals
                ],
                default=0,
            ),
        )
        rebuilt["_centroid"] = [
            sum(item["_embedding"][index] for item in signals) / len(signals)
            for index in range(len(signals[0]["_embedding"]))
        ]
        rebuilt["version"] += 1
        self._refresh_operator_brief(rebuilt, max(signals, key=lambda item: item["received_at"]))
        return rebuilt

    def split(
        self,
        cluster_id: str,
        signal_ids: list[str],
        reason: str,
        actor: str = "console-operator",
    ) -> dict[str, Any]:
        self._ensure_ready()
        with self._lock:
            source = deepcopy(self._get_cluster(cluster_id))
            if source["status"] == "promoted":
                raise InvalidTransition("Promoted incidents must be reconciled in Command Center")
            selected = list(dict.fromkeys(signal_ids))
            if not set(selected).issubset(source["signal_ids"]) or len(selected) >= len(source["signal_ids"]):
                raise InvalidTransition("Split evidence must be a non-empty proper subset of the cluster")
            remaining = [item_id for item_id in source["signal_ids"] if item_id not in selected]
            target = deepcopy(source)
            target["id"] = f"CLU-{self._cluster_sequence}"
            self._cluster_sequence += 1
            target["status"] = "emerging"
            target["incident_id"] = None
            source = self._rebuild_cluster(source, remaining)
            target = self._rebuild_cluster(target, selected)
            moved = []
            for signal_id in selected:
                signal = deepcopy(self._signals[signal_id])
                signal["cluster_id"] = target["id"]
                signal["status"] = "correlated"
                self._signals[signal_id] = signal
                moved.append(signal)
            self.store.save_split(source, target, moved, actor, reason)
            self._clusters[source["id"]] = source
            self._clusters[target["id"]] = target
            return {"source": self._public(source), "created": self._public(target)}

    def action(self, cluster_id: str, action: str, actor: str = "console-operator") -> dict[str, Any]:
        if action == "promote":
            return self.promote(cluster_id, actor)["cluster"]
        self._ensure_ready()
        with self._lock:
            cluster = self._get_cluster(cluster_id)
            cluster = deepcopy(cluster)
            if action == "verify":
                if cluster["status"] == "dismissed":
                    raise InvalidTransition("A dismissed cluster cannot be verified")
                if cluster["status"] == "promoted":
                    return self._public(cluster)
                cluster["status"] = "verified"
            elif action == "dismiss":
                if cluster["status"] == "promoted":
                    raise InvalidTransition("A promoted incident cannot be dismissed in Signal Fusion")
                cluster["status"] = "dismissed"
            else:
                raise InvalidTransition(f"Unsupported action: {action}")
            cluster["version"] += 1
            self.store.save_cluster_action(cluster, action, actor)
            self._clusters[cluster_id] = cluster
            return self._public(cluster)

    def promote(self, cluster_id: str, actor: str = "console-operator") -> dict[str, Any]:
        self._ensure_ready()
        with self._lock:
            cluster = deepcopy(self._get_cluster(cluster_id))
            if cluster["status"] == "emerging":
                raise InvalidTransition("Verify the cluster before promoting it")
            if cluster["status"] == "dismissed":
                raise InvalidTransition("A dismissed cluster cannot be promoted")
            existing = self.store.get_incident_by_cluster(cluster_id)
            if existing:
                event = next(
                    (
                        item
                        for item in self.store.list_events(0, 1000)
                        if item["aggregate_id"] == existing["id"]
                        and item["event_type"] == "signal_fusion.incident.promoted.v1"
                    ),
                    None,
                )
                return {
                    "cluster": self._public(cluster),
                    "incident": existing,
                    "event_id": event["id"] if event else 0,
                }
            cluster["status"] = "promoted"
            cluster["version"] += 1
            incident_id = f"INC-{self._incident_sequence}"
            self._incident_sequence += 1
            cluster["incident_id"] = incident_id
            incident = self._build_incident(cluster, None)
            event_id = self.store.save_promotion(cluster, incident, actor)
            self._clusters[cluster_id] = cluster
            return {
                "cluster": self._public(cluster),
                "incident": incident,
                "event_id": event_id,
            }

    def _build_incident(
        self, cluster: dict[str, Any], existing: dict[str, Any] | None
    ) -> dict[str, Any]:
        now = utcnow()
        return {
            "id": existing["id"] if existing else cluster["incident_id"],
            "source_cluster_id": cluster["id"],
            "version": existing["version"] + 1 if existing else 1,
            "state": "ready_for_command_center",
            "title": cluster["title"],
            "summary": cluster["summary"],
            "category": cluster["category"],
            "priority": cluster["priority"],
            "severity": cluster["severity"],
            "confidence": cluster["confidence"],
            "location": cluster["location"],
            "latitude": cluster["latitude"],
            "longitude": cluster["longitude"],
            "first_reported_at": cluster["first_seen"],
            "last_reported_at": cluster["last_seen"],
            "signal_count": cluster["signal_count"],
            "duplicate_count": cluster["duplicate_count"],
            "source_mix": cluster["source_mix"],
            "source_signal_ids": cluster["signal_ids"],
            "key_facts": cluster["key_facts"],
            "risk_flags": cluster["risk_flags"],
            "recommended_actions": cluster["recommended_actions"],
            "created_at": existing["created_at"] if existing else now,
            "updated_at": now,
        }

    def merge(
        self, source_id: str, target_id: str, actor: str = "console-operator"
    ) -> dict[str, Any]:
        self._ensure_ready()
        with self._lock:
            if source_id == target_id:
                raise KeyError(source_id)
            source = deepcopy(self._get_cluster(source_id))
            target = deepcopy(self._get_cluster(target_id))
            if source["status"] == "promoted" or target["status"] == "promoted":
                raise InvalidTransition("Promoted incidents must be reconciled in Command Center")
            left_count, right_count = target["signal_count"], source["signal_count"]
            target["_centroid"] = [
                (a * left_count + b * right_count) / (left_count + right_count)
                for a, b in zip(target["_centroid"], source["_centroid"])
            ]
            target["signal_count"] += source["signal_count"]
            target["duplicate_count"] += source["duplicate_count"]
            target["signal_ids"].extend(source["signal_ids"])
            target["severity"] = max(target["severity"], source["severity"])
            target["priority"] = priority_for(target["severity"])
            target["confidence"] = min(99, max(target["confidence"], source["confidence"]) + 3)
            target["version"] += 1
            for name, count in source["source_mix"].items():
                target["source_mix"][name] = target["source_mix"].get(name, 0) + count
            changed_signals = []
            for signal_id in source["signal_ids"]:
                changed = deepcopy(self._signals[signal_id])
                changed["cluster_id"] = target_id
                changed["status"] = "duplicate"
                changed_signals.append(changed)
            source["status"] = "dismissed"
            source["version"] += 1
            self._refresh_operator_brief(target, changed_signals[-1])
            self.store.save_merge(source, target, changed_signals, actor)
            self._clusters[source_id] = source
            self._clusters[target_id] = target
            for signal in changed_signals:
                self._signals[signal["id"]] = signal
            return self._public(target)

    def list_incidents(self) -> list[dict[str, Any]]:
        self._ensure_ready()
        return self.store.list_incidents()

    def get_incident(self, incident_id: str) -> dict[str, Any]:
        self._ensure_ready()
        incident = next(
            (item for item in self.store.list_incidents() if item["id"] == incident_id),
            None,
        )
        if incident is None:
            raise KeyError(incident_id)
        return incident

    def events(self, after: int = 0, limit: int = 100) -> dict[str, Any]:
        self._ensure_ready()
        events = self.store.list_events(after, limit)
        return {"events": events, "next_cursor": events[-1]["id"] if events else after}

    def audit(self, limit: int = 100) -> list[dict[str, Any]]:
        self._ensure_ready()
        return self.store.list_audit(limit)

    def _get_cluster(self, cluster_id: str) -> dict[str, Any]:
        if cluster_id not in self._clusters:
            raise KeyError(cluster_id)
        return self._clusters[cluster_id]


engine = FusionEngine()
