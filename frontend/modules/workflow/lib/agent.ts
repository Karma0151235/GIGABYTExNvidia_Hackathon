import { endCall, startCall } from "@/modules/workflow/lib/modelActivity";

const LABEL = { call_brief: "Call brief", case_summary: "Case summary" } as const;

/** Returns the model's text, or null (caller falls back to a template). Every attempt is logged for the status bar. */
export async function requestAgentText(kind: keyof typeof LABEL, payload: unknown): Promise<string | null> {
  const id = startCall("nano", LABEL[kind]);
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, case: payload }),
    });
    const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!response.ok || !data.text) {
      endCall(id, "error", data.error ?? `HTTP ${response.status}`);
      return null;
    }
    endCall(id, "ok");
    return data.text;
  } catch (error) {
    endCall(id, "error", error instanceof Error ? error.message : "request failed");
    return null;
  }
}
