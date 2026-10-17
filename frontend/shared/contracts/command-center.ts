export type {
  CommandIncident,
  CommandIncidentStatus,
  CommandPriority,
  CommandSnapshot,
  CommandStats,
  SlaStatus,
} from "@/modules/command-center/types";

export type CommandCenterIntegrationEvent = {
  id: number;
  event_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: Record<string, unknown>;
  created_at: string;
};

export type CommandCenterEventFeed = {
  events: CommandCenterIntegrationEvent[];
  next_cursor: number;
};
