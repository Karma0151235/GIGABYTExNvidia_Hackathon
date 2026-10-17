import type { SignalFusionIncidentHandoff } from "../../../shared/contracts/signal-fusion";

export type SignalSource = "WEATHER" | "TRAFFIC" | "CALL" | "FIELD" | "SMS" | "APP" | "RADIO" | "CCTV";
export type SignalStatus = "new" | "correlated" | "clustered" | "duplicate" | "dismissed";
export type ClusterStatus = "emerging" | "verified" | "promoted" | "dismissed";
export type IncidentPriority = "P1" | "P2" | "P3" | "P4";

export type Signal = {
  id: string;
  external_id?: string;
  source: SignalSource;
  caller: string;
  transcript: string;
  location: string;
  latitude: number;
  longitude: number;
  observed_at?: string;
  occurred_at?: string;
  received_at: string;
  severity: number;
  source_confidence: number;
  evidence_role: "early_warning" | "corroborating" | "primary_report" | "duplicate_report";
  status: SignalStatus;
  cluster_id?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type SignalCluster = {
  id: string;
  title: string;
  summary: string;
  category: string;
  location: string;
  latitude: number;
  longitude: number;
  signal_count: number;
  duplicate_count: number;
  confidence: number;
  severity: number;
  priority?: IncidentPriority;
  status: ClusterStatus;
  first_seen: string;
  last_seen: string;
  source_mix: Record<string, number>;
  signal_ids: string[];
  key_facts?: string[];
  risk_flags?: string[];
  recommended_actions?: string[];
  incident_id?: string;
  version?: number;
  correlated_count: number;
  evidence_count: number;
  independent_sources: number;
  first_call_at?: string;
  lead_time_minutes?: number;
  sla_started_at?: string;
  sla_seconds_elapsed?: number;
  confidence_trend: "rising" | "stable" | "decaying";
  confidence_history: {
    at: string;
    confidence: number;
    source: string;
    action: string;
  }[];
  action_state: "Monitor" | "Staged" | "Awaiting Review" | "Incident Ready";
  recommended_action: string;
  risk_zone_id?: string;
  confidence_explanation: string;
};

export type FusionDecision = {
  outcome: "new_cluster" | "correlated" | "duplicate" | "replayed";
  reason: string;
  cluster_id: string;
  cluster_created: boolean;
  fusion_score: number;
  semantic_score: number;
  distance_km?: number;
  provider: string;
};

export type IngestionResult = {
  signal: Signal;
  cluster: SignalCluster;
  decision: FusionDecision;
  processing_latency_ms: number;
};

export type IncidentHandoff = SignalFusionIncidentHandoff;

export type RiskAssessment = {
  id: string;
  zone: string;
  latitude: number;
  longitude: number;
  level: "low" | "medium" | "high" | "critical";
  confidence: number;
  recommended_action: "monitor" | "notify" | "stage_unit" | "alert_hospital";
  generated_at: string;
  expires_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  version: number;
  radius_km: number;
  status: "watching" | "acknowledged" | "incident_linked" | "expired";
  confidence_trend: "rising" | "stable" | "decaying";
  latest_evidence_at?: string;
  linked_cluster_id?: string;
  summary: string;
  evidence: {
    id?: string;
    source: string;
    severity: number;
    observed_at?: string;
    evidence: Record<string, string | number | boolean>;
  }[];
};

export type TriageSummary = {
  call_id: string;
  received_at: string;
  call_class: "silent" | "spam" | "emergency";
  priority: "P1" | "P2" | "P3" | null;
  location: { text: string | null; area: string | null; lat: number | null; lng: number | null } | null;
  patients: number | null;
  conscious: boolean | null;
  breathing: boolean | null;
  complaint: string | null;
  missing: string[];
  transcript: string;
  audio_url: string | null;
};

export type TriageResult = {
  summary: TriageSummary;
  path: { question: string; answer: string }[];
  ingestion?: IngestionResult | null;
};

export type VoiceSample = { name: string; url: string };

export type TriageCapabilities = {
  speech_to_text: string;
  model: string;
  configured: boolean;
  supported_extensions: string[];
  max_audio_bytes: number;
  preserves_audio_evidence: boolean;
  automatic_dispatch: boolean;
};

export type PromotionResult = {
  cluster: SignalCluster;
  incident: IncidentHandoff;
  event_id: number;
};

export type FusionStats = {
  signals_today: number;
  active_clusters: number;
  duplicates_removed: number;
  reduction_rate: number;
  average_confidence: number;
  processing_latency_ms: number;
  incidents_ready?: number;
};

export type FusionSnapshot = {
  generated_at: string;
  stats: FusionStats;
  signals: Signal[];
  clusters: SignalCluster[];
  risks: RiskAssessment[];
  audit_events: AuditEvent[];
};

export type AuditEvent = {
  id: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
};
