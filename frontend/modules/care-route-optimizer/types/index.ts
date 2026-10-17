import type { DispatchFacility, DispatchRecommendation } from "@/modules/live-dispatch/types";

export type CareOption = {
  facility: DispatchFacility;
  eligible: boolean;
  required_capabilities: string[];
  capability_match: boolean;
  distance_km: number | null;
  eta_minutes: number | null;
  score: number;
  reason: string;
};

export type CareOptions = {
  incident_id: string;
  dispatch_id: string;
  dispatch_version: number;
  required_capabilities: string[];
  current_plan: CareOption | null;
  options: CareOption[];
};

export type RerouteResult = { dispatch: DispatchRecommendation; previous_facility_id: string | null; reason: string };

export type PreAlertDraft = {
  draft_id: string;
  dispatch_id: string;
  incident_id: string;
  facility_id: string;
  required_capabilities: string[];
  eta_minutes: number | null;
  message: string;
  delivery_status: "draft_only";
};
