import type { ResponseRoute } from "@/types/emergency";
import type { DispatchSnapshot } from "@/modules/live-dispatch/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type MockCallPreview = {
  revision?: number;
  received_at?: string;
  classification: "scam" | "misc" | "legit_distress";
  routable: boolean;
  reason: string;
  call_id?: string;
  location_text?: string;
  incident_coordinate?: [number, number];
  road_access_coordinate?: [number, number];
  resolution?: "osm_locality" | "provided_coordinate";
  matched_place?: string | null;
  incident?: { title: string; summary?: string | null; category?: string | null; priority?: "P1" | "P2" | "P3" | "P4" | null };
  selected?: {
    unit_id: string;
    origin_coordinate: [number, number];
    eta_minutes: number;
    distance_km: number;
    coordinates: [number, number][];
  };
  alternatives?: Array<{ unit_id: string; eta_minutes: number; distance_km: number }>;
};

export type IngestionResult = {
  call_id: string;
  classification: MockCallPreview["classification"];
  transcript?: string;
  geolocation?: { locality?: string; address?: string; latitude?: number; longitude?: number };
  incident?: { title: string; summary?: string; category?: string; priority?: "P1" | "P2" | "P3" | "P4" };
};

async function postPreview(path: string, payload: unknown): Promise<MockCallPreview> {
  const response = await fetch(`${API_BASE}/api/live-dispatch/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item) => item.msg).join("; ") : `Preview returned ${response.status}`);
  }
  return data as MockCallPreview;
}

export function previewIngestionResult(payload: IngestionResult): Promise<MockCallPreview> {
  return postPreview("ingestion/preview", payload);
}

export async function fetchLatestIngestionPreview(): Promise<MockCallPreview | null> {
  const response = await fetch(`${API_BASE}/api/live-dispatch/ingestion/latest`, { cache: "no-store" });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Latest ingestion preview returned ${response.status}`);
  return response.json() as Promise<MockCallPreview>;
}

export async function fetchIngestionPreviews(): Promise<MockCallPreview[]> {
  const response = await fetch(`${API_BASE}/api/live-dispatch/ingestion/previews`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Call previews returned ${response.status}`);
  return response.json() as Promise<MockCallPreview[]>;
}

export async function previewMockCall(locationText: string, classification: MockCallPreview["classification"]): Promise<MockCallPreview> {
  return postPreview("mock-call/preview", { call_id: "MOCK-CALL-001", classification, location_text: locationText });
}

type ApiSnapshot = {
  routing_online: boolean;
  routing_provider: string;
  dataset: string;
  locations: DispatchSnapshot["locations"];
  routes: Array<{
    id: string;
    unit_id: string;
    incident_id: string;
    hospital_id: string;
    color: string;
    coordinates: ResponseRoute["coordinates"];
    distance_km: number;
    duration_minutes: number;
    leg: "to_scene" | "to_hospital";
  }>;
  failed_route_ids: string[];
  generated_at: string | null;
  command_center_online: boolean;
  units: DispatchSnapshot["units"];
  facilities: DispatchSnapshot["facilities"];
  incidents: DispatchSnapshot["incidents"];
  recommendations: DispatchSnapshot["recommendations"];
  stats: DispatchSnapshot["stats"];
};

export async function fetchDispatchSnapshot(signal?: AbortSignal): Promise<DispatchSnapshot> {
  const response = await fetch(`${API_BASE}/api/live-dispatch/snapshot`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Live routing API returned ${response.status}`);
  }

  const data = (await response.json()) as ApiSnapshot;
  return {
    routingOnline: data.routing_online,
    routingProvider: data.routing_provider,
    dataset: data.dataset,
    locations: data.locations,
    failedRouteIds: data.failed_route_ids,
    generatedAt: data.generated_at,
    commandCenterOnline: data.command_center_online,
    units: data.units,
    facilities: data.facilities,
    incidents: data.incidents,
    recommendations: data.recommendations,
    stats: data.stats,
    routes: data.routes.map((route) => ({
      id: route.id,
      unitId: route.unit_id,
      incidentId: route.incident_id,
      hospitalId: route.hospital_id,
      color: route.color,
      coordinates: route.coordinates,
      etaMinutes: route.duration_minutes,
      distanceKm: route.distance_km,
      leg: route.leg,
    })),
  };
}

export async function performDispatchAction(action: import("@/modules/live-dispatch/types").DispatchAction) {
  const base = `${API_BASE}/api/live-dispatch/dispatches/${action.recommendation.id}`;
  let path = action.type;
  let body: Record<string, unknown> = { expected_version: action.recommendation.version };
  if (action.type === "reject") body = { ...body, reason: action.reason, reoptimize: true };
  if (action.type === "reassign") body = { ...body, unit_id: action.unitId, reason: action.reason };
  if (action.type === "backup") body = { ...body, capability: action.capability, reason: action.reason };
  if (action.type === "transition") { path = "transition"; body = { ...body, status: action.status }; }
  if (action.type === "cancel") body = { ...body, note: action.note };
  const response = await fetch(`${base}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Operator-Id": "dispatch-console" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail?.message ?? payload?.detail ?? `Dispatch action returned ${response.status}`);
  }
  return response.json();
}
