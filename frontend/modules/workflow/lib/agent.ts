export async function requestAgentText(kind: "call_brief" | "case_summary", payload: unknown): Promise<string | null> {
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, case: payload }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { text?: string };
    return data.text ?? null;
  } catch {
    return null;
  }
}
