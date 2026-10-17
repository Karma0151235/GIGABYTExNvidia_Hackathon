"use client";

import { AlertTriangle, ArrowRight, Play, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getTriageCapabilities,
  listVoiceSamples,
  signalFusionApiUrl,
  triageCall,
} from "@/modules/signal-fusion/lib/api";
import type { TriageCapabilities, TriageResult, VoiceSample } from "@/modules/signal-fusion/types";

const MAX_AUDIO_BYTES = 6_000_000;
const CONCURRENCY = 3; // Keep the DGX request pool bounded.

// Static shape of the backend tree (triage_service.run_tree); the response path says how far a call got.
const TREE = [
  { question: "Speech detected?", exitOn: "no", leaf: "silent" },
  { question: "Genuine request for help?", exitOn: "no", leaf: "spam" },
  { question: "Life threat?", exitOn: "yes", leaf: "P1" },
  { question: "Urgent?", exitOn: "yes", leaf: "P2" },
] as const;

const LEAVES: Record<string, { label: string; tone: string }> = {
  silent: { label: "Silent - drop", tone: "border-slate-400 bg-slate-100 text-slate-700" },
  spam: { label: "Spam - drop", tone: "border-amber-400 bg-amber-50 text-amber-800" },
  P1: { label: "P1 emergency", tone: "border-red-400 bg-red-50 text-red-700" },
  P2: { label: "P2 emergency", tone: "border-orange-400 bg-orange-50 text-orange-700" },
  P3: { label: "P3 emergency", tone: "border-sky-400 bg-sky-50 text-sky-700" },
};

type CallState = { status: "idle" | "running" | "done" | "error"; result?: TriageResult; error?: string; audioUrl?: string };

function outcomeOf(result: TriageResult): string {
  const { call_class, priority } = result.summary;
  return call_class === "emergency" ? priority ?? "P3" : call_class;
}

function yesNo(value: boolean | null): string {
  return value == null ? "unknown" : value ? "yes" : "no";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read audio file"));
    reader.readAsDataURL(file);
  });
}

function Node({ state, children }: { state: "taken" | "idle" | "leaf"; children: React.ReactNode }) {
  const style = state === "taken" ? "border-blue-500 bg-white" : "border-dashed border-slate-300 bg-slate-50 text-slate-400";
  return <div className={`rounded-lg border-2 px-3 py-2 text-xs ${style}`}>{children}</div>;
}

function Edge({ active, label }: { active: boolean; label?: string }) {
  return (
    <div className="relative flex flex-1 items-center">
      <div className={`h-0.5 w-full ${active ? "bg-blue-500" : "bg-slate-200"}`} />
      {label ? <span className={`absolute left-1/2 -translate-x-1/2 -translate-y-3 text-[9px] font-bold uppercase ${active ? "text-blue-700" : "text-slate-400"}`}>{label}</span> : null}
    </div>
  );
}

function Spine({ active }: { active: boolean }) {
  return <div className={`ml-24 h-5 w-0.5 ${active ? "bg-blue-500" : "bg-slate-200"}`} />;
}

function CallGraph({ result, audioUrl }: { result: TriageResult; audioUrl?: string }) {
  const { summary, path } = result;
  const outcome = outcomeOf(result);
  const leafTone = (key: string) => (outcome === key ? LEAVES[key].tone : "border-dashed border-slate-300 bg-slate-50 text-slate-400");
  const missing = new Set(summary.missing);
  const loc = summary.location;
  const facts = summary.call_class === "emergency" ? [
    { key: "location", label: "Location", value: loc?.text ?? "unknown", sub: loc?.lat != null ? `${loc.area} / ${loc.lat.toFixed(4)}, ${loc.lng?.toFixed(4)}` : "no geolocation" },
    { key: "patients", label: "Patients", value: String(summary.patients ?? "unknown") },
    { key: "conscious", label: "Conscious", value: yesNo(summary.conscious) },
    { key: "breathing", label: "Breathing", value: yesNo(summary.breathing) },
  ] : [];

  return (
    <div className="space-y-0">
      <div className="flex items-stretch gap-0">
        <div className="w-48 shrink-0"><Node state="taken"><div className="font-bold text-slate-950">Recording</div>{audioUrl ? <audio controls preload="none" src={audioUrl} className="mt-1 h-7 w-full" /> : null}</Node></div>
        <Edge active label="STT" />
        <div className="w-[55%] shrink-0"><Node state="taken"><div className="font-bold text-slate-950">Transcript</div><p className="mt-1 leading-5 text-slate-700">{summary.transcript || "(no speech)"}</p></Node></div>
      </div>

      {TREE.map((step, index) => {
        const reached = index < path.length;
        const exited = reached && outcome === step.leaf;
        return (
          <div key={step.question}>
            <Spine active={reached} />
            <div className="flex items-center">
              <div className="w-48 shrink-0">
                <Node state={reached ? "taken" : "idle"}>
                  <div className="font-semibold">{step.question}</div>
                  {reached ? <div className="mt-0.5 font-black text-slate-950">{path[index].answer}</div> : null}
                </Node>
              </div>
              <Edge active={exited} label={step.exitOn} />
              <div className={`w-36 shrink-0 rounded-lg border-2 px-3 py-2 text-xs font-black ${leafTone(step.leaf)}`}>{LEAVES[step.leaf].label}</div>
            </div>
          </div>
        );
      })}
      <Spine active={outcome === "P3"} />
      <div className={`w-48 rounded-lg border-2 px-3 py-2 text-xs font-black ${leafTone("P3")}`}>{LEAVES.P3.label}</div>

      {facts.length ? (
        <>
          <Spine active />
          <div className="rounded-xl border-2 border-blue-500 p-3">
            <div className="text-[10px] font-black uppercase tracking-wide text-blue-700">Extracted dispatch facts</div>
            <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
              {facts.map(({ key, label, value, sub }) => (
                <div key={key} className={`rounded-lg border-2 px-3 py-2 text-xs ${missing.has(key) ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}>
                  <div className="text-[9px] font-bold uppercase text-slate-500">{label}{missing.has(key) ? " - ask caller" : ""}</div>
                  <div className="mt-0.5 font-black capitalize text-slate-950">{value}</div>
                  {sub ? <div className="mt-0.5 font-mono text-[10px] text-slate-500">{sub}</div> : null}
                </div>
              ))}
            </div>
            {summary.complaint ? <p className="mt-2 text-xs text-slate-700"><span className="font-bold">Complaint:</span> {summary.complaint}</p> : null}
          </div>
        </>
      ) : null}

      <Spine active />
      <div className="rounded-xl border-2 border-slate-800 bg-slate-950 p-3">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Summary JSON / handoff to routing</div>
        <pre className="mt-2 overflow-x-auto text-[11px] leading-5 text-emerald-300">{JSON.stringify(summary, null, 2)}</pre>
      </div>
      {result.dispatch_preview?.routable ? <p className="mt-2 text-xs font-semibold text-emerald-700">Route preview sent to Live Dispatch for {result.dispatch_preview.selected?.unit_id}. No ambulance has been dispatched.</p> : null}
      {result.dispatch_preview && !result.dispatch_preview.routable ? <p className="mt-2 text-xs font-semibold text-amber-700">{result.dispatch_preview.reason}</p> : null}
      {result.ingestion_error ? <p className="mt-2 text-xs font-semibold text-amber-700">Fusion unavailable: {result.ingestion_error}</p> : null}
    </div>
  );
}

type Props = {
  onOpenDispatch: (callId: string) => void;
  onTriaged?: (name: string, result: TriageResult) => void;
  onSelectCall?: (callId: string) => void;
  renderBrief?: (callId: string) => React.ReactNode;
};

export default function LiveIntakePage({ onOpenDispatch, onTriaged, onSelectCall, renderBrief }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [calls, setCalls] = useState<Record<string, CallState>>({});
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [capabilities, setCapabilities] = useState<TriageCapabilities>();

  useEffect(() => {
    void getTriageCapabilities().then(setCapabilities).catch(() => setCapabilities(undefined));
    void listVoiceSamples().then(setSamples).catch((caught: Error) => setError(caught.message));
  }, []);

  const patch = (name: string, next: CallState) => setCalls((current) => ({ ...current, [name]: { ...current[name], ...next } }));

  const run = async (name: string, payload: Parameters<typeof triageCall>[0], audioUrl?: string) => {
    patch(name, { status: "running", audioUrl });
    try {
      const result = await triageCall({ ...payload, caller: "999 live line" });
      patch(name, { status: "done", result, audioUrl });
      onTriaged?.(name, result);
    } catch (caught) {
      patch(name, { status: "error", error: caught instanceof Error ? caught.message : "Triage failed" });
    }
  };

  const runSample = (sample: VoiceSample) => run(sample.name, { sample: sample.name }, signalFusionApiUrl(sample.url));

  const runAll = async () => {
    const queue = [...samples];
    setSelected(queue[0]?.name);
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await runSample(next);
    }));
  };

  const upload = async (file?: File) => {
    setError(undefined);
    if (!file) return;
    if (file.size > (capabilities?.max_audio_bytes ?? MAX_AUDIO_BYTES)) {
      setError("Recording exceeds the 6 MB limit.");
      return;
    }
    const name = `upload: ${file.name}`;
    setSelected(name);
    await run(name, { audio_base64: await fileToBase64(file), audio_filename: file.name }, URL.createObjectURL(file));
  };

  const rows = [...samples.map((sample) => sample.name), ...Object.keys(calls).filter((name) => name.startsWith("upload: "))];
  const current = selected ? calls[selected] : undefined;
  const busy = Object.values(calls).some((call) => call.status === "running");

  return (
    <section className="sf-shell flex h-full min-h-0 flex-col overflow-y-auto text-slate-800">

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[300px_1fr]">
        <aside className="sf-panel flex flex-col overflow-hidden">
          <div className="flex gap-2 border-b border-slate-200 p-3">
            <button type="button" disabled={busy || !samples.length} onClick={() => void runAll()} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 text-xs font-bold text-white disabled:opacity-50"><Play size={13} />Run all {samples.length}</button>
            <input ref={inputRef} type="file" className="hidden" accept="audio/mpeg,audio/wav,.mp3,.wav" onChange={(event) => void upload(event.target.files?.[0])} />
            <button type="button" onClick={() => inputRef.current?.click()} aria-label="Upload recording" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-slate-600"><UploadCloud size={15} /></button>
          </div>
          <div className={`border-b border-slate-200 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide ${capabilities?.configured ? "text-emerald-700" : "text-amber-700"}`}>
            {capabilities?.configured ? `STT ${capabilities.model}` : "DGX transcription unavailable"}
          </div>
          {error ? <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div> : null}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((name) => {
              const call = calls[name];
              const outcome = call?.result ? outcomeOf(call.result) : undefined;
              const sample = samples.find((item) => item.name === name);
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => { setSelected(name); if (call?.result) onSelectCall?.(call.result.summary.call_id); else if (!call && sample) void runSample(sample); }}
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-[11px] ${selected === name ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{name.replace(/\.mp3$/, "").replaceAll("_", " ")}</span>
                    {outcome ? <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-black ${LEAVES[outcome].tone}`}>{outcome}</span> : null}
                    {call?.status === "running" ? <span className="shrink-0 text-[9px] font-bold text-blue-600">...</span> : null}
                    {call?.status === "error" ? <span className="shrink-0 text-[9px] font-bold text-red-600">error</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="sf-panel min-w-0 p-5">
          {current?.result ? (
            <>
              {renderBrief?.(current.result.summary.call_id)}
              <CallGraph result={current.result} audioUrl={current.audioUrl} />
              {current.result.ingestion ? <p className="mt-3 text-[10px] font-semibold text-slate-600">Recorded in fusion as {current.result.ingestion.signal.id}.</p> : null}
              {current.result.summary.call_class === "emergency" ? <button type="button" onClick={() => onOpenDispatch(current.result!.summary.call_id)} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Open route <ArrowRight size={13} /></button> : null}
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-xs text-slate-500">
              {current?.status === "running" ? "Transcribing and triaging..." : current?.status === "error" ? current.error : "Run all samples, pick one, or upload a recording."}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
