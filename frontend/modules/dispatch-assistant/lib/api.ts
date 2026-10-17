import type { AssistantResponse, SessionEntry, SopSnippet } from "@/modules/dispatch-assistant/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail?.message ?? payload?.detail;
    throw new Error(typeof detail === "string" ? detail : `Dispatch Assistant API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function askAssistant(payload: { question: string; incidentId?: string; sessionId?: string }) {
  return request<AssistantResponse>("/api/dispatch-assistant/query", {
    method: "POST",
    body: JSON.stringify({ question: payload.question, incident_id: payload.incidentId, session_id: payload.sessionId }),
  });
}

export function askCopilot(payload: { question: string; incidentId?: string; sessionId?: string }) {
  return request<AssistantResponse>("/api/dispatch-assistant/copilot", {
    method: "POST",
    body: JSON.stringify({ question: payload.question, incident_id: payload.incidentId, session_id: payload.sessionId }),
  });
}

export function fetchAssistantSession(sessionId: string) {
  return request<SessionEntry[]>(`/api/dispatch-assistant/sessions/${sessionId}`, { cache: "no-store" });
}

export function fetchSop(topic: "operator-approval" | "dispatch-review") {
  return request<SopSnippet>(`/api/dispatch-assistant/sop/${topic}`, { cache: "no-store" });
}
