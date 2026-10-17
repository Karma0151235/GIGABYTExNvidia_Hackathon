import { NextResponse } from "next/server";

// Probes each DGX Spark vLLM server's /v1/models from the Next server. Defaults match the backend's.
// ponytail: backend URLs are read from this process's env, so a backend-only override is not reflected here.
const SERVERS = {
  lightning: process.env.DGX_TRIAGE_BASE_URL ?? "http://192.168.0.108:9000/v1",
  nano: process.env.AGENT_LLM_BASE_URL ?? "http://192.168.0.108:9006/v1",
  omni: process.env.DGX_VLM_BASE_URL ?? "http://192.168.0.108:9001/v1",
};

export const dynamic = "force-dynamic";

export async function GET() {
  const results = await Promise.all(
    Object.entries(SERVERS).map(async ([key, base]) => {
      const started = Date.now();
      try {
        const response = await fetch(`${base.replace(/\/$/, "")}/models`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
        return [key, { ok: response.ok, ms: Date.now() - started, url: base, error: response.ok ? undefined : `HTTP ${response.status}` }];
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "no answer within 3 s" : error instanceof Error ? (error.cause as Error | undefined)?.message ?? error.message : "unreachable";
        return [key, { ok: false, ms: Date.now() - started, url: base, error: reason }];
      }
    }),
  );
  return NextResponse.json({ checkedAt: new Date().toISOString(), servers: Object.fromEntries(results) });
}
