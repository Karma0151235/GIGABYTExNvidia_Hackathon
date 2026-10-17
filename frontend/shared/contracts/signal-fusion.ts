export type SignalFusionPriority = "P1" | "P2" | "P3" | "P4";

export type SignalFusionIncidentHandoff = {
  id: string;
  source_cluster_id: string;
  version: number;
  state: "ready_for_command_center";
  title: string;
  summary: string;
  category: string;
  priority: SignalFusionPriority;
  severity: number;
  confidence: number;
  location: string;
  latitude: number;
  longitude: number;
  first_reported_at: string;
  last_reported_at: string;
  signal_count: number;
  duplicate_count: number;
  source_mix: Record<string, number>;
  source_signal_ids: string[];
  key_facts: string[];
  risk_flags: string[];
  recommended_actions: string[];
  created_at: string;
  updated_at: string;
};

export type SignalFusionIntegrationEvent = {
  id: number;
  event_type:
    | "signal_fusion.incident.promoted.v1"
    | "signal_fusion.incident.updated.v1";
  aggregate_id: string;
  aggregate_version: number;
  payload: SignalFusionIncidentHandoff;
  created_at: string;
};

export type SignalFusionEventFeed = {
  events: SignalFusionIntegrationEvent[];
  next_cursor: number;
};
