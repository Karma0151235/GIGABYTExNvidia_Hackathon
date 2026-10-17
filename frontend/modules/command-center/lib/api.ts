import type { CommandAction, CommandIncident, CommandSnapshot } from "@/modules/command-center/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Operator-Id": "command-console", ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail?.message ?? body?.detail ?? `Command Center API returned ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return response.json() as Promise<T>;
}

export function fetchCommandSnapshot(signal?: AbortSignal) {
  return request<CommandSnapshot>("/api/command-center/snapshot", { signal });
}

export function performCommandAction(action: CommandAction): Promise<CommandIncident> {
  const base = `/api/command-center/incidents/${action.incident.id}`;
  if (action.type === "acknowledge") {
    return request(`${base}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ expected_version: action.incident.command_version }),
    });
  }
  if (action.type === "priority") {
    return request(`${base}/priority`, {
      method: "POST",
      body: JSON.stringify({ priority: action.priority, reason: action.reason, expected_version: action.incident.command_version }),
    });
  }
  if (action.type === "assign") {
    return request(`${base}/assign`, {
      method: "POST",
      body: JSON.stringify({
        unit_id: action.unitId,
        receiving_hospital_id: action.hospitalId,
        rationale: action.rationale,
        expected_version: action.incident.command_version,
      }),
    });
  }
  return request(`${base}/transition`, {
    method: "POST",
    body: JSON.stringify({ status: action.status, note: action.note, expected_version: action.incident.command_version }),
  });
}
