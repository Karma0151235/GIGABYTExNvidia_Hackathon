export type {
  CandidateScore,
  DispatchAction,
  DispatchFacility,
  DispatchIncident,
  DispatchRecommendation,
  DispatchSnapshot,
  DispatchStats,
  DispatchUnit,
} from "@/modules/live-dispatch/types";

export type LiveDispatchIntegrationEvent = {
  id: number;
  event_type: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: Record<string, unknown>;
  created_at: string;
};

export type LiveDispatchEventFeed = {
  events: LiveDispatchIntegrationEvent[];
  next_cursor: number;
};
