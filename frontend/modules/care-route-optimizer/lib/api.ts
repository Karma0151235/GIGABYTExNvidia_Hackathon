import type { CareOptions, PreAlertDraft, RerouteResult } from "@/modules/care-route-optimizer/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Operator-Id": "dispatch-console", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail?.message ?? payload?.detail ?? `Care Route API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchCareOptions(incidentId: string, signal?: AbortSignal) {
  return request<CareOptions>(`/api/live-dispatch/incidents/${incidentId}/care-options`, { signal, cache: "no-store" });
}

export function rerouteDispatch(dispatchId: string, payload: { facilityId: string; expectedVersion: number; reason: string; disruptionEvidence?: string; overrideIneligible?: boolean }) {
  return request<RerouteResult>(`/api/live-dispatch/dispatches/${dispatchId}/reroute`, {
    method: "POST",
    body: JSON.stringify({
      facility_id: payload.facilityId,
      expected_version: payload.expectedVersion,
      reason: payload.reason,
      disruption_evidence: payload.disruptionEvidence || undefined,
      override_ineligible: payload.overrideIneligible ?? false,
    }),
  });
}

export function createPreAlertDraft(dispatchId: string) {
  return request<PreAlertDraft>(`/api/live-dispatch/dispatches/${dispatchId}/pre-alert-draft`, { method: "POST" });
}
