import { signalFusionApiUrl } from "@/modules/signal-fusion/lib/api";

// Mirrors backend/modules/case-audit/models/schemas.py.
export type AuditChatRequest = {
  question: string;
  sources: { id: string; text: string }[];
  history: { role: "user" | "assistant"; content: string }[];
};
export type AuditChatResponse = { answer: string; model: string; cited: string[] };

export async function askCaseAudit(payload: AuditChatRequest): Promise<AuditChatResponse> {
  const response = await fetch(signalFusionApiUrl("/api/case-audit/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `Audit service returned ${response.status}`);
  }
  return response.json() as Promise<AuditChatResponse>;
}
