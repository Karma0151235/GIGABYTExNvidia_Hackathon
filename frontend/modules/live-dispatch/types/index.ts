import type { Coordinate, ResponseRoute } from "@/types/emergency";

export type RoutingStatus = "loading" | "online" | "offline";

export type DispatchLocation = {
  id: string;
  name: string;
  kind: "hospital" | "ambulance_base" | "incident";
  coordinate: Coordinate;
  metadata: Record<string, string | number | boolean>;
};

export type DispatchSnapshot = {
  routingOnline: boolean;
  routingProvider: string;
  dataset: string;
  locations: DispatchLocation[];
  routes: ResponseRoute[];
  failedRouteIds: string[];
  generatedAt: string | null;
  commandCenterOnline: boolean;
  units: DispatchUnit[];
  facilities: DispatchFacility[];
  incidents: DispatchIncident[];
  recommendations: DispatchRecommendation[];
  stats: DispatchStats | null;
};

export type DispatchUnit = {
  id: string; callsign: string; agency: string; base_facility_id: string | null;
  status: "available" | "reserved" | "dispatched" | "en_route" | "on_scene" | "transporting" | "at_hospital" | "offline";
  equipment_type: string; capabilities: string[]; crew: Array<{ name: string; role: string }>;
  latitude: number; longitude: number; heading: number; speed_kph: number; fuel_percent: number;
  active_incident_id: string | null; location_updated_at: string; version: number; updated_at: string;
};

export type DispatchFacility = {
  id: string; name: string; facility_type: "hospital" | "ambulance_base";
  latitude: number; longitude: number; capabilities: string[]; accepting_patients: boolean;
  ed_load_percent: number; ambulance_bays: number; updated_at: string;
};

export type DispatchIncident = {
  id: string; command_version: number; title: string; summary: string; category: string;
  priority: "P1" | "P2" | "P3" | "P4"; severity: number; status: string; location: string;
  latitude: number; longitude: number; sla_status: string; sla_seconds_remaining: number;
  assigned_unit_id: string | null; receiving_hospital_id: string | null; risk_flags: string[];
};

export type CandidateScore = {
  unit_id: string; eligible: boolean; score: number; eta_minutes: number | null; distance_km: number | null;
  capability_score: number; readiness_score: number; agency_score: number; workload_score: number;
  missing_capabilities: string[]; reason: string;
};

export type DispatchRecommendation = {
  id: string; incident_id: string; incident_version: number; priority: string; severity: number; category: string;
  status: "recommended" | "accepted" | "rejected" | "en_route" | "on_scene" | "transporting" | "completed" | "cancelled";
  is_backup: boolean; unit_id: string; receiving_facility_id: string | null; optimization_score: number;
  score_breakdown: Record<string, number>; alternatives: CandidateScore[]; origin_coordinate: Coordinate;
  scene_coordinate: Coordinate; destination_coordinate: Coordinate | null; route_to_scene: Coordinate[];
  route_to_hospital: Coordinate[] | null; scene_distance_km: number; scene_eta_minutes: number;
  hospital_distance_km: number | null; hospital_eta_minutes: number | null; algorithm_version: string;
  decision_reason: string; operator_id: string | null; operator_note: string | null; rejection_reason: string | null;
  recommended_at: string; accepted_at: string | null; completed_at: string | null; updated_at: string; version: number;
};

export type DispatchStats = { active_incidents: number; available_units: number; recommended: number; active_dispatches: number; average_recommended_eta: number | null; p1_uncovered: number };

export type DispatchAction =
  | { type: "accept"; recommendation: DispatchRecommendation }
  | { type: "reject"; recommendation: DispatchRecommendation; reason: string }
  | { type: "reassign"; recommendation: DispatchRecommendation; unitId: string; reason: string }
  | { type: "backup"; recommendation: DispatchRecommendation; capability?: string; reason: string }
  | { type: "transition"; recommendation: DispatchRecommendation; status: "en_route" | "on_scene" | "transporting" | "completed" }
  | { type: "cancel"; recommendation: DispatchRecommendation; note?: string };
