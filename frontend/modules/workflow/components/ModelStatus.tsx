"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, RefreshCw } from "lucide-react";
import { MODEL_NAME, useModelCalls, type ModelCall, type ModelKey } from "@/modules/workflow/lib/modelActivity";

type Probe = { ok: boolean; ms: number; url: string; error?: string };
type Health = { checkedAt: string; servers: Record<ModelKey, Probe> };

const MODELS: ModelKey[] = ["lightning", "nano", "omni"];
const ROLE: Record<ModelKey, string> = { lightning: "triage", nano: "summaries", omni: "STT + photo VLM" };
const STATUS_TONE: Record<ModelCall["status"], string> = { calling: "text-blue-600", ok: "text-emerald-600", error: "text-red-600", skipped: "text-slate-400" };

export default function ModelStatus() {
  const calls = useModelCalls();
  const [health, setHealth] = useState<Health>();
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const probe = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/models/health", { cache: "no-store" });
      setHealth(await response.json());
    } catch {
      setHealth(undefined);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void probe();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void probe(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [probe]);

  // Re-probe as soon as a call fails, so the pill turns red without waiting for the next poll.
  const lastError = calls.find((call) => call.status === "error")?.id;
  useEffect(() => { if (lastError) void probe(); }, [lastError, probe]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className="relative normal-case tracking-normal">
      <button type="button" data-testid="model-status" onClick={() => setOpen((value) => !value)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50" aria-expanded={open}>
        <Cpu size={13} className="text-[#76b900]" />DGX
        {MODELS.map((model) => {
          const busy = calls.some((call) => call.model === model && call.status === "calling");
          const server = health?.servers[model];
          const dot = server == null ? "bg-slate-300" : server.ok ? "bg-emerald-500" : "bg-red-500";
          return (
            <span key={model} data-testid={`model-${model}`} data-state={busy ? "calling" : server == null ? "unknown" : server.ok ? "up" : "down"} title={server ? `${MODEL_NAME[model]} ${server.ok ? `reachable, ${server.ms} ms` : `unreachable: ${server.error}`}` : "checking"} className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 ${busy ? "bg-blue-50 text-blue-700" : ""}`}>
              <span className="relative flex h-2 w-2">{busy ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" /> : null}<span className={`relative inline-flex h-2 w-2 rounded-full ${busy ? "bg-blue-500" : dot}`} /></span>
              {MODEL_NAME[model]}{busy ? "..." : ""}
            </span>
          );
        })}
      </button>

      {open ? (
        <div data-testid="model-status-panel" className="absolute right-0 top-full z-50 mt-2 w-[440px] rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-[.14em] text-slate-500">DGX Spark endpoints</span>
            <button type="button" onClick={() => void probe()} className="flex items-center gap-1 text-[11px] font-semibold text-blue-700"><RefreshCw size={11} className={checking ? "animate-spin" : ""} />Recheck</button>
          </div>
          <ul className="space-y-1.5">
            {MODELS.map((model) => {
              const server = health?.servers[model];
              return (
                <li key={model} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${server == null ? "bg-slate-300" : server.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                    <b>{MODEL_NAME[model]}</b><span className="text-slate-400">{ROLE[model]}</span>
                    <span className={`ml-auto font-semibold ${server == null ? "text-slate-400" : server.ok ? "text-emerald-700" : "text-red-700"}`}>{server == null ? "checking" : server.ok ? `reachable / ${server.ms} ms` : "unreachable"}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400">{server?.url}{server && !server.ok ? ` / ${server.error}` : ""}</div>
                </li>
              );
            })}
          </ul>
          <div className="mb-1.5 mt-3 text-[10px] font-black uppercase tracking-[.14em] text-slate-500">Recent model calls</div>
          {calls.length ? (
            <ol data-testid="model-calls" className="max-h-64 space-y-1 overflow-y-auto">
              {calls.slice(0, 15).map((call) => (
                <li key={call.id} className="rounded-md bg-slate-50 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 font-semibold">{MODEL_NAME[call.model]}</span>
                    <span className="min-w-0 flex-1 truncate">{call.label}</span>
                    <span className={`shrink-0 font-semibold ${STATUS_TONE[call.status]}`}>{call.status === "calling" ? "calling..." : call.status}{call.ms != null ? ` ${(call.ms / 1000).toFixed(1)}s` : ""}</span>
                  </div>
                  {call.detail ? <div className={`mt-0.5 break-words text-[10px] ${call.status === "error" ? "text-red-600" : "text-slate-500"}`}>{call.detail}</div> : null}
                </li>
              ))}
            </ol>
          ) : <p className="text-slate-400">No model calls yet. Run a call in Call Records.</p>}
        </div>
      ) : null}
    </div>
  );
}
