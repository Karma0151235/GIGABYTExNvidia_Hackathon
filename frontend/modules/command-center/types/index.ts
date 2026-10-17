export type CommandPriority = "P1" | "P2" | "P3" | "P4";
export type CommandIncidentStatus =
  | "new"
  | "acknowledged"
  | "assigned"
  | "en_route"
  | "on_scene"
  | "transporting"
  | "resolved"
  | "cancelled";
export type SlaStatus = "on_target" | "at_risk" | "breached" | "met";

export type CommandIncident = {
  id: string;
  source_cluster_id: string;
  source_version: number;
  command_version: number;
  title: string;
  summary: string;
  category: string;
  priority: CommandPriority;
  original_priority: CommandPriority;
  severity: number;
  confidence: number;
  status: CommandIncidentStatus;
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
  assigned_unit_id: string | null;
  receiving_hospital_id: string | null;
  owning_agency: string | null;
  priority_override_reason: string | null;
  sla_deadline: string;
  sla_status: SlaStatus;
  sla_seconds_remaining: number;
  acknowledged_at: string | null;
  assigned_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CommandStats = {
  active_incidents: number;
  unacknowledged: number;
  critical_incidents: number;
  assigned_incidents: number;
  unassigned_incidents: number;
  breached_sla: number;
  at_risk_sla: number;
  target_met_percent: number;
  average_acknowledgement_minutes: number | null;
};

export type CommandSnapshot = {
  generated_at: string;
  source_cursor: number;
  source_online: boolean;
  stats: CommandStats;
  incidents: CommandIncident[];
};

export type CommandAction =
  | { type: "acknowledge"; incident: CommandIncident }
  | { type: "priority"; incident: CommandIncident; priority: CommandPriority; reason: string }
  | { type: "assign"; incident: CommandIncident; unitId: string; hospitalId?: string; rationale?: string }
  | { type: "transition"; incident: CommandIncident; status: CommandIncidentStatus; note?: string };
