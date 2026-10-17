import type {
  FusionSnapshot,
  IngestionResult,
  PromotionResult,
  Signal,
  RiskAssessment,
  SignalCluster,
  TriageCapabilities,
  TriageResult,
  VoiceSample,
} from "../types";


const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";


export function signalFusionApiUrl(path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith("data:")) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}


async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { detail?: string | { message?: string } } | null;
  const detail = body?.detail;
  const message = typeof detail === "string" ? detail : detail?.message;
  return new Error(message ?? fallback);
}


export async function getFusionSnapshot(): Promise<FusionSnapshot> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/snapshot`, { cache: "no-store" });
  if (!response.ok) throw await apiError(response, "Signal Fusion API unavailable");
  return response.json() as Promise<FusionSnapshot>;
}


export async function updateCluster(
  id: string,
  action: "verify" | "dismiss",
): Promise<{ cluster: SignalCluster; promotion?: never }> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/clusters/${id}/${action}`, {
    method: "POST",
    headers: { "X-Operator-Id": "anwar-console" },
  });
  if (!response.ok) throw await apiError(response, `Unable to ${action} cluster`);
  return { cluster: await response.json() as SignalCluster };
}


export async function promoteCluster(id: string): Promise<PromotionResult> {
  const response = await fetch(
    `${API_BASE}/api/signal-fusion/clusters/${id}/promote-to-incident`,
    { method: "POST", headers: { "X-Operator-Id": "anwar-console" } },
  );
  if (!response.ok) throw await apiError(response, "Unable to promote cluster");
  return response.json() as Promise<PromotionResult>;
}


export async function getRisks(): Promise<RiskAssessment[]> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/risks`, { cache: "no-store" });
  if (!response.ok) throw await apiError(response, "Oracle risk feed unavailable");
  return response.json() as Promise<RiskAssessment[]>;
}


export async function acknowledgeRisk(id: string): Promise<RiskAssessment> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/risks/${id}/acknowledge`, {
    method: "POST",
    headers: { "X-Operator-Id": "anwar-console" },
  });
  if (!response.ok) throw await apiError(response, "Unable to acknowledge risk");
  return response.json() as Promise<RiskAssessment>;
}


export async function overrideCluster(
  id: string,
  recommendedAction: string,
  reason: string,
): Promise<SignalCluster> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/clusters/${id}/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Operator-Id": "anwar-console" },
    body: JSON.stringify({ recommended_action: recommendedAction, reason }),
  });
  if (!response.ok) throw await apiError(response, "Unable to override recommendation");
  return response.json() as Promise<SignalCluster>;
}


export async function splitCluster(
  id: string,
  signalIds: string[],
  reason: string,
): Promise<{ source: SignalCluster; created: SignalCluster }> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/clusters/${id}/split`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Operator-Id": "anwar-console" },
    body: JSON.stringify({ signal_ids: signalIds, reason }),
  });
  if (!response.ok) throw await apiError(response, "Unable to split evidence");
  return response.json() as Promise<{ source: SignalCluster; created: SignalCluster }>;
}


export async function mergeClusters(sourceId: string, targetId: string): Promise<SignalCluster> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/clusters/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Operator-Id": "anwar-console" },
    body: JSON.stringify({ source_cluster_id: sourceId, target_cluster_id: targetId }),
  });
  if (!response.ok) throw await apiError(response, "Unable to merge clusters");
  return response.json() as Promise<SignalCluster>;
}


export async function triageCall(payload: {
  sample?: string;
  transcript?: string;
  audio_base64?: string;
  audio_filename?: string;
  caller?: string;
  latitude?: number;
  longitude?: number;
}): Promise<TriageResult> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await apiError(response, "Unable to triage call");
  return response.json() as Promise<TriageResult>;
}


export async function listVoiceSamples(): Promise<VoiceSample[]> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/triage/samples`, { cache: "no-store" });
  if (!response.ok) throw await apiError(response, "Voice samples unavailable");
  return response.json() as Promise<VoiceSample[]>;
}


export async function getTriageCapabilities(): Promise<TriageCapabilities> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/triage/capabilities`, {
    cache: "no-store",
  });
  if (!response.ok) throw await apiError(response, "Live Intake capability check unavailable");
  return response.json() as Promise<TriageCapabilities>;
}


export async function ingestSignal(
  payload: Pick<Signal, "source" | "caller" | "transcript" | "location" | "latitude" | "longitude"> & {
    external_id?: string;
    metadata?: Record<string, string | number | boolean>;
  },
): Promise<IngestionResult> {
  const response = await fetch(`${API_BASE}/api/signal-fusion/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await apiError(response, "Unable to ingest signal");
  return response.json() as Promise<IngestionResult>;
}
