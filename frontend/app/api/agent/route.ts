import { NextRequest, NextResponse } from "next/server";

// OpenAI-compatible chat endpoint. Point AGENT_LLM_BASE_URL at OpenRouter today, DGX Spark vLLM later
// (e.g. http://192.168.0.108:9006/v1 with AGENT_LLM_MODEL=nano). No key needed for the DGX.
const PROMPTS = {
  call_brief:
    "You are a 999 dispatch assistant. Write a 2-4 sentence plain-English brief for the dispatcher from the triage JSON and transcript: who, what, where, priority, and what is still unknown. Only state facts present in the input. No diagnosis, no treatment advice. Plain text, no markdown.",
  case_summary:
    "Summarise this emergency case's current status for the coordinating team in at most 5 short sentences: current stage, key patient facts, vitals concerns if any, and what happens next. Only use facts in the input; say 'unknown' rather than guess. This is a draft, not a clinical decision. Plain text, no markdown.",
} as const;

export async function POST(request: NextRequest) {
  const base = process.env.AGENT_LLM_BASE_URL;
  const model = process.env.AGENT_LLM_MODEL;
  if (!base || !model) return NextResponse.json({ error: "Agent LLM not configured" }, { status: 503 });

  let body: { kind?: keyof typeof PROMPTS; case?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const prompt = body.kind ? PROMPTS[body.kind] : undefined;
  if (!prompt) return NextResponse.json({ error: "Unknown kind" }, { status: 400 });

  const key = process.env.AGENT_LLM_API_KEY;
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        // Nemotron nano/lightning reason first and leave content null until done; give them room.
        max_tokens: 1500,
        temperature: 0.2,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify(body.case ?? {}).slice(0, 12_000) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return NextResponse.json({ error: `LLM returned ${response.status}` }, { status: 502 });
    const data = await response.json();
    const text: string | undefined = data.choices?.[0]?.message?.content?.trim();
    if (!text) return NextResponse.json({ error: "Model returned no content" }, { status: 502 });
    return NextResponse.json({ text, model });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "LLM request failed" }, { status: 502 });
  }
}
