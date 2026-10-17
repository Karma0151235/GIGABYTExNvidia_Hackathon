// Server-side call to the DGX Spark Nemotron OpenAI-compatible chat endpoint (no API key).
// Used by Next route handlers only.
const BASE = process.env.AGENT_LLM_BASE_URL ?? "http://192.168.0.108:9006/v1";
export const NEMOTRON_MODEL = process.env.AGENT_LLM_MODEL ?? "nano";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function nemotronChat(messages: ChatMessage[]): Promise<{ text: string } | { error: string }> {
  try {
    const response = await fetch(`${BASE.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: NEMOTRON_MODEL,
        // Nemotron nano/lightning reason first and leave content null until done; give them room.
        max_tokens: 1500,
        temperature: 0.2,
        messages,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { error: `${NEMOTRON_MODEL} returned HTTP ${response.status}` };
    const data = await response.json();
    const text: string | undefined = data.choices?.[0]?.message?.content?.trim();
    return text ? { text } : { error: "Model returned no content" };
  } catch (error) {
    // fetch() hides the network reason (ECONNREFUSED, EHOSTUNREACH...) in error.cause.
    const reason = error instanceof Error && error.name === "TimeoutError" ? "no answer within 30 s" : error instanceof Error ? (error.cause as Error | undefined)?.message ?? error.message : "request failed";
    return { error: `${NEMOTRON_MODEL} at ${BASE}: ${reason}` };
  }
}
