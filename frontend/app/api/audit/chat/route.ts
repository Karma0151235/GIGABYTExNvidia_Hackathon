import { NextRequest, NextResponse } from "next/server";
import { NEMOTRON_MODEL, nemotronChat, type ChatMessage } from "@/lib/nemotron";

const SYSTEM =
  "You are the Aegis 999 audit assistant. You explain what happened in emergency cases, from the 999 call audio through triage, ambulance routing, first responder care and hospital admission. " +
  "Answer ONLY from the numbered sources in the user's message. Cite every fact inline like [S2]. If the sources do not contain the answer, say so plainly. " +
  "Be concise: at most 6 sentences or a short list. Do not give clinical advice. Plain text, no markdown headings.";

type Body = { question?: string; sources?: { id: string; text: string }[]; history?: ChatMessage[] };

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "Question is required" }, { status: 400 });

  const sources = (body.sources ?? []).slice(0, 12).map((source) => `[${source.id}] ${source.text.slice(0, 800)}`).join("\n");
  const history = (body.history ?? []).filter((message) => message.role === "user" || message.role === "assistant").slice(-6);
  const result = await nemotronChat([
    { role: "system", content: SYSTEM },
    ...history.map((message) => ({ role: message.role, content: message.content.slice(0, 2000) })),
    { role: "user", content: `Sources:\n${sources || "(no matching records)"}\n\nQuestion: ${question}` },
  ]);
  return "text" in result ? NextResponse.json({ text: result.text, model: NEMOTRON_MODEL }) : NextResponse.json(result, { status: 502 });
}
