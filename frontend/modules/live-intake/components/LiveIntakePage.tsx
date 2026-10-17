"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, ArrowRight, AudioLines, BrainCircuit, ChevronRight,
  FileAudio, FileText, GitMerge, Headphones, Languages, MapPin, Radio,
  ShieldCheck, Sparkles, UploadCloud, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSignalFusion } from "@/modules/signal-fusion/hooks/useSignalFusion";
import {
  getTriageCapabilities,
  signalFusionApiUrl,
  triageCall,
} from "@/modules/signal-fusion/lib/api";
import type {
  Signal,
  TriageCapabilities,
  TriageResult,
} from "@/modules/signal-fusion/types";

const MAX_AUDIO_BYTES = 6_000_000;
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".webm", ".m4a", ".mp4", ".ogg"];
const pipeline = ["Receive", "Transcribe", "Extract facts", "Fuse evidence"];
const demoTranscripts = [
  {
    label: "P1 cardiac",
    text: "Tolong cepat, dekat KLCC concourse bawah. Ayah saya tiba-tiba jatuh, dia tak sedar dan nafas susah. Please send ambulance.",
  },
  {
    label: "P1 collision",
    text: "Hello 999, accident teruk dekat Jalan Tun Razak underpass. Motor kena kereta, rider tak bergerak dan banyak darah dekat kepala.",
  },
  {
    label: "P2 fall",
    text: "Saya dekat Cheras luar stesen MRT. Seorang perempuan jatuh tangga, dia sedar tetapi kaki mungkin patah dan tak boleh bangun.",
  },
];

const waveform = [36, 58, 42, 78, 52, 90, 64, 45, 82, 55, 96, 68, 40, 72, 51, 86, 62, 44, 76, 57, 91, 66, 38, 70, 48, 80, 60, 43, 74, 54, 88, 63];

function formatBytes(value: number): string {
  if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1_000))} KB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function myt(value: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function relativeTime(value: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function priorityStyle(priority?: string): string {
  if (priority === "P1") return "border-red-200 bg-red-50 text-red-700";
  if (priority === "P2") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read audio file"));
    reader.readAsDataURL(file);
  });
}

function metadataText(signal: Signal, key: string): string | undefined {
  const value = signal.metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function metadataNumber(signal: Signal, key: string): number | undefined {
  const value = signal.metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function Pipeline({ busy, step, complete }: { busy: boolean; step: number; complete: boolean }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {pipeline.map((label, index) => {
        const active = complete || index <= step;
        return (
          <div key={label} className="relative min-w-0">
            <div className={`h-1 overflow-hidden rounded-full ${active ? "bg-blue-100" : "bg-slate-100"}`}>
              {active ? (
                <motion.div
                  className="h-full bg-gradient-to-r from-blue-600 to-cyan-500"
                  initial={{ width: complete || index < step ? "100%" : "15%" }}
                  animate={{ width: complete || index < step ? "100%" : busy ? ["18%", "88%", "38%"] : "100%" }}
                  transition={{ duration: 1.5, repeat: busy && index === step ? Infinity : 0 }}
                />
              ) : null}
            </div>
            <div className={`mt-2 truncate text-[9px] font-bold uppercase tracking-wide ${active ? "text-blue-700" : "text-slate-400"}`}>
              {index + 1}. {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecentCall({
  signal,
  selected,
  now,
  onSelect,
}: {
  signal: Signal;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const priority = metadataText(signal, "triage_priority") ?? "P3";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-b border-slate-200 px-4 py-3 text-left transition last:border-0 ${selected ? "bg-blue-50" : "bg-white hover:bg-slate-50"}`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black ${priorityStyle(priority)}`}>{priority}</span>
        <span className="truncate font-mono text-[9px] font-semibold text-slate-500">{signal.id}</span>
        <span className="ml-auto shrink-0 text-[9px] text-slate-500">{relativeTime(signal.received_at, now)}</span>
      </div>
      <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-900">{signal.transcript}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[9px] text-slate-500">
        <MapPin size={10} className="text-sky-700" />
        <span className="truncate">{signal.location}</span>
        {metadataText(signal, "audio_url") ? <AudioLines size={11} className="ml-auto text-blue-700" /> : null}
        <ChevronRight size={11} />
      </div>
    </button>
  );
}

export default function LiveIntakePage({
  onOpenSignalFusion,
}: {
  onOpenSignalFusion: () => void;
}) {
  const { snapshot, connected, refresh } = useSignalFusion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"audio" | "transcript">("audio");
  const [file, setFile] = useState<File>();
  const [audioUrl, setAudioUrl] = useState<string>();
  const [transcript, setTranscript] = useState("");
  const [caller, setCaller] = useState("MERS 999 live line");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<TriageResult>();
  const [selectedSignalId, setSelectedSignalId] = useState<string>();
  const [capabilities, setCapabilities] = useState<TriageCapabilities>();
  // Keep the SSR and first client render identical; start the live clock after hydration.
  const [now, setNow] = useState(0);

  useEffect(() => {
    void getTriageCapabilities().then(setCapabilities).catch(() => setCapabilities(undefined));
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!file) {
      setAudioUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const timer = window.setInterval(() => setStep((current) => Math.min(3, current + 1)), 900);
    return () => window.clearInterval(timer);
  }, [busy]);

  const recentCalls = useMemo(
    () => snapshot.signals
      .filter((signal) => signal.source === "CALL")
      .sort((left, right) => new Date(right.received_at).getTime() - new Date(left.received_at).getTime())
      .slice(0, 10),
    [snapshot.signals],
  );
  const selectedSignal = snapshot.signals.find((signal) => signal.id === selectedSignalId);
  const priorityCalls = recentCalls.filter((signal) => metadataText(signal, "triage_priority") === "P1").length;

  const chooseFile = (candidate?: File) => {
    setError(undefined);
    if (!candidate) return;
    const extension = `.${candidate.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!AUDIO_EXTENSIONS.includes(extension)) {
      setError("Use an MP3, WAV, WebM, M4A, MP4, or OGG recording.");
      return;
    }
    if (candidate.size > (capabilities?.max_audio_bytes ?? MAX_AUDIO_BYTES)) {
      setError("The call recording exceeds the 6 MB demo limit.");
      return;
    }
    setFile(candidate);
    setMode("audio");
    setResult(undefined);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "audio" && !file) {
      setError("Select a call recording first.");
      return;
    }
    if (mode === "transcript" && transcript.trim().length < 5) {
      setError("Enter at least five characters of caller speech.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const payload = mode === "audio" && file
        ? { audio_base64: await fileToBase64(file), audio_filename: file.name, caller }
        : { transcript: transcript.trim(), caller };
      const next = await triageCall(payload);
      setResult(next);
      setSelectedSignalId(next.ingestion.signal.id);
      setStep(3);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to process this call");
    } finally {
      setBusy(false);
    }
  };

  const displayedAudio = result?.audio?.url
    ? signalFusionApiUrl(result.audio.url)
    : selectedSignal && metadataText(selectedSignal, "audio_url")
      ? signalFusionApiUrl(metadataText(selectedSignal, "audio_url")!)
      : result ? audioUrl : undefined;
  const displayedPriority = result?.triage.priority ?? (selectedSignal ? metadataText(selectedSignal, "triage_priority") : undefined);
  const displayedConfidence = result
    ? Math.round(result.triage.confidence * 100)
    : selectedSignal ? Math.round((metadataNumber(selectedSignal, "triage_confidence") ?? selectedSignal.source_confidence) * 100) : undefined;

  return (
    <section className="sf-shell flex h-full min-h-0 flex-col overflow-y-auto text-slate-800">
      <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-5 py-3 shadow-sm backdrop-blur-xl">
        <div className="relative grid h-10 w-10 place-items-center rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 text-blue-700">
          <Headphones size={20} />
          <motion.span className="absolute -inset-1 rounded-xl border border-cyan-300/30" animate={{ opacity: [0.2, 0.7, 0.2], scale: [0.96, 1.06, 0.96] }} transition={{ duration: 2.4, repeat: Infinity }} />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-slate-950">Live 999 Intake</h1>
          <p className="text-[9px] font-bold uppercase tracking-[.18em] text-slate-500">Call audio / transcription / dispatch facts / signal fusion</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wide ${capabilities?.configured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            <span className="relative h-1.5 w-1.5 rounded-full bg-current"><span className="absolute inset-0 animate-ping rounded-full bg-current" /></span>
            {capabilities?.configured ? "Scribe connected" : "Scribe key required"}
          </span>
          <span className={`hidden items-center gap-2 rounded-full border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wide sm:inline-flex ${connected ? "border-sky-200 bg-sky-50 text-sky-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            <Radio size={11} />Fusion {connected ? "live" : "local"}
          </span>
          <div className="hidden font-mono text-xs font-semibold text-slate-700 lg:block">
            {now ? myt(new Date(now).toISOString()) : "--:--:--"} <span className="text-[9px] text-slate-400">MYT</span>
          </div>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-4 lg:grid-cols-4">
        {[
          { label: "Calls in evidence", value: recentCalls.length, detail: "Retained in fusion", icon: AudioLines, tone: "text-blue-700 bg-blue-50" },
          { label: "Critical intake", value: priorityCalls, detail: "P1 calls visible", icon: Activity, tone: "text-red-700 bg-red-50" },
          { label: "Speech engine", value: capabilities?.model ?? "scribe_v2", detail: "Multilingual STT", icon: Sparkles, tone: "text-cyan-700 bg-cyan-50" },
          { label: "Decision boundary", value: "Human", detail: "No auto dispatch", icon: ShieldCheck, tone: "text-emerald-700 bg-emerald-50" },
        ].map(({ label, value, detail, icon: Icon, tone }, index) => (
          <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }} className="sf-panel flex items-center gap-3 p-3">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}><Icon size={16} /></div>
            <div className="min-w-0"><div className="text-[9px] font-bold uppercase tracking-[.13em] text-slate-500">{label}</div><div className="truncate text-lg font-black text-slate-950">{value}</div><div className="text-[9px] text-slate-500">{detail}</div></div>
          </motion.div>
        ))}
      </div>

      <div className="grid min-h-[620px] flex-1 gap-3 p-4 xl:min-h-0 xl:grid-cols-[minmax(480px,1.25fr)_minmax(330px,.85fr)_300px]">
        <form onSubmit={submit} className="sf-panel relative flex min-h-[590px] flex-col overflow-hidden">
          <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-cyan-100/50 blur-3xl" />
          <div className="relative border-b border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div><div className="anwar-kicker">Incoming line / channel 04</div><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Hear the caller. Extract what matters.</h2><p className="mt-2 max-w-xl text-xs leading-5 text-slate-600">Upload a live call recording for multilingual ElevenLabs transcription, or enter a transcript when audio is unavailable.</p></div>
              <div className="hidden h-12 items-end gap-1 sm:flex">{waveform.slice(0, 12).map((height, index) => <motion.span key={index} className="w-1 rounded-full bg-gradient-to-t from-blue-600 to-cyan-400" animate={busy ? { height: [`${height * 0.35}%`, `${height}%`, `${height * 0.5}%`] } : { height: `${height}%` }} transition={{ duration: 0.7, repeat: busy ? Infinity : 0, delay: index * 0.04 }} />)}</div>
            </div>
            <div className="mt-5"><Pipeline busy={busy} step={step} complete={Boolean(result)} /></div>
          </div>

          <div className="relative flex-1 space-y-4 p-5">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button type="button" onClick={() => setMode("audio")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold ${mode === "audio" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}><FileAudio size={13} />Call recording</button>
              <button type="button" onClick={() => setMode("transcript")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold ${mode === "transcript" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}><FileText size={13} />Transcript only</button>
            </div>

            {mode === "audio" ? (
              <div
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}
                className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-5 transition ${dragging ? "border-blue-500 bg-blue-50" : file ? "border-cyan-300 bg-cyan-50/60" : "border-slate-300 bg-slate-50 hover:border-blue-300"}`}
              >
                <input ref={inputRef} type="file" className="hidden" accept="audio/mpeg,audio/wav,audio/webm,audio/mp4,audio/ogg,.m4a" onChange={(event) => chooseFile(event.target.files?.[0])} />
                {!file ? (
                  <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center py-5 text-center">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-[0_12px_30px_rgba(37,99,235,.25)]"><UploadCloud size={22} /></span>
                    <span className="mt-4 text-sm font-bold text-slate-950">Drop a 999 call recording here</span>
                    <span className="mt-1 text-[10px] text-slate-500">MP3, WAV, WebM, M4A, MP4 or OGG / maximum 6 MB</span>
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-blue-700 shadow-sm"><FileAudio size={20} /></span>
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-950">{file.name}</div><div className="mt-0.5 text-[10px] text-slate-500">{formatBytes(file.size)} / ready for secure transcription</div></div>
                      <button type="button" onClick={() => { setFile(undefined); if (inputRef.current) inputRef.current.value = ""; }} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500"><X size={14} /></button>
                    </div>
                    {audioUrl ? <audio controls preload="metadata" src={audioUrl} className="mt-4 h-10 w-full" /> : null}
                    <div className="mt-4 flex h-12 items-center justify-center gap-1 overflow-hidden rounded-lg border border-cyan-100 bg-white/70 px-3">
                      {waveform.map((height, index) => <motion.span key={index} className="w-1 rounded-full bg-gradient-to-t from-blue-600 to-cyan-400" style={{ height: `${height}%` }} animate={busy ? { scaleY: [0.45, 1, 0.6] } : undefined} transition={{ duration: 0.6, repeat: busy ? Infinity : 0, delay: index * 0.025 }} />)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Enter caller speech in Malay, English, Manglish, Mandarin, or Tamil..." className="h-44 w-full resize-none rounded-xl border border-slate-300 bg-white p-4 text-sm leading-6 text-slate-900 outline-none" />
                <div className="mt-2 flex flex-wrap gap-2">{demoTranscripts.map((sample) => <button key={sample.label} type="button" onClick={() => setTranscript(sample.text)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700">{sample.label}</button>)}</div>
              </div>
            )}

            <label className="block text-[9px] font-bold uppercase tracking-[.14em] text-slate-500">Call source / operator<input value={caller} onChange={(event) => setCaller(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3 text-xs" /></label>
            {error ? <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div> : null}
          </div>

          <div className="relative flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4">
            <ShieldCheck size={14} className="text-emerald-700" /><span className="text-[10px] text-slate-600">Audio stays server-side. Every result requires operator review.</span>
            <button disabled={busy || (mode === "audio" ? !file : transcript.trim().length < 5)} className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <><motion.span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />Processing call</> : <><Sparkles size={14} />Transcribe and fuse<ArrowRight size={13} /></>}
            </button>
          </div>
        </form>

        <section className="sf-panel flex min-h-[590px] flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-200 p-4">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700"><BrainCircuit size={17} /></div>
            <div><h2 className="text-sm font-bold text-slate-950">Operator triage card</h2><p className="text-[10px] text-slate-500">Structured facts, not automatic action</p></div>
            {displayedPriority ? <span className={`ml-auto rounded-lg border px-2.5 py-1.5 text-sm font-black ${priorityStyle(displayedPriority)}`}>{displayedPriority}</span> : null}
          </div>

          {result || selectedSignal ? (
            <motion.div key={result?.ingestion.signal.id ?? selectedSignal?.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-4">
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.15em] text-blue-700"><Sparkles size={12} />AI condition summary</div>
                <div className="mt-2 text-base font-bold leading-6 text-slate-950">{result?.triage.condition_summary ?? selectedSignal?.transcript}</div>
                <p className="mt-2 text-[10px] leading-4 text-slate-600">{result?.triage.rationale ?? metadataText(selectedSignal!, "triage_rationale") ?? "Review source evidence and confirm priority."}</p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2 text-[9px] font-bold uppercase text-slate-500"><MapPin size={11} />Location</div><div className="mt-2 text-xs font-bold text-slate-950">{result?.triage.location_name ?? selectedSignal?.location}</div></div>
                <div className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2 text-[9px] font-bold uppercase text-slate-500"><Users size={11} />Patients</div><div className="mt-2 text-xs font-bold text-slate-950">{result?.triage.patient_count ?? metadataNumber(selectedSignal!, "patient_count") ?? 1}</div></div>
                <div className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2 text-[9px] font-bold uppercase text-slate-500"><Languages size={11} />Language</div><div className="mt-2 text-xs font-bold text-slate-950">{result?.triage.caller_language ?? metadataText(selectedSignal!, "caller_language") ?? "Unresolved"}</div></div>
                <div className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2 text-[9px] font-bold uppercase text-slate-500"><Activity size={11} />Confidence</div><div className="mt-2 text-xs font-bold text-slate-950">{displayedConfidence ?? 0}%</div></div>
              </div>

              {displayedAudio ? <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wide text-slate-500"><AudioLines size={12} className="text-blue-700" />Original audio evidence</div><audio controls preload="metadata" src={displayedAudio} className="mt-3 h-9 w-full" /></div> : null}

              <div className="mt-3 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wide text-slate-500"><FileText size={11} />Verbatim transcript</div>
                <p className="mt-2 text-xs leading-5 text-slate-700">{result?.triage.transcript ?? selectedSignal?.transcript}</p>
              </div>

              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wide text-emerald-700"><GitMerge size={12} />Fusion outcome</div>
                <div className="mt-2 text-xs font-bold capitalize text-slate-950">{result?.ingestion.decision.outcome.replace("_", " ") ?? selectedSignal?.status}</div>
                <div className="mt-1 text-[10px] leading-4 text-slate-600">{result?.ingestion.decision.reason ?? `Retained as evidence in ${selectedSignal?.cluster_id ?? "an active cluster"}.`}</div>
                <div className="mt-3 flex items-center gap-3 border-t border-emerald-200 pt-2 font-mono text-[9px] text-slate-600"><span>{result?.ingestion.cluster.id ?? selectedSignal?.cluster_id}</span>{result ? <><span>{Math.round(result.ingestion.decision.fusion_score * 100)}% match</span><span>{result.ingestion.processing_latency_ms}ms</span></> : null}</div>
              </div>
            </motion.div>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400"><AudioLines size={24} /></span><h3 className="mt-4 text-sm font-bold text-slate-900">Awaiting call evidence</h3><p className="mt-2 max-w-xs text-[10px] leading-5 text-slate-500">A completed transcription will appear here with priority, location, patients, language, confidence, and its Signal Fusion decision.</p></div>
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 p-3">
            <ShieldCheck size={13} className="text-emerald-700" /><span className="text-[9px] text-slate-600">No dispatch or escalation occurs here.</span>
            <button type="button" onClick={onOpenSignalFusion} className="ml-auto inline-flex items-center gap-1 text-[9px] font-bold text-blue-700">Open Live Signals <ArrowRight size={11} /></button>
          </div>
        </section>

        <aside className="sf-panel flex min-h-[590px] flex-col overflow-hidden">
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-950">Recent 999 calls</h2><p className="mt-0.5 text-[10px] text-slate-500">Persistent CALL evidence</p></div><span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[9px] font-bold text-red-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />LIVE</span></div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {recentCalls.length ? recentCalls.map((signal) => <RecentCall key={signal.id} signal={signal} selected={signal.id === selectedSignalId} now={now} onSelect={() => { setSelectedSignalId(signal.id); if (signal.id !== result?.ingestion.signal.id) setResult(undefined); }} />) : <div className="p-5 text-center text-[10px] text-slate-500">No calls have entered the fusion engine.</div>}
          </div>
          <div className="border-t border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-[9px] text-slate-500"><span>Evidence preserved</span><span className="font-mono font-bold text-emerald-700">0 discarded</span></div>
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {busy ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 shadow-2xl"><motion.span className="h-3 w-3 rounded-full border-2 border-blue-200 border-t-blue-700" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} /><div><div className="text-xs font-bold text-slate-950">{pipeline[step]}</div><div className="text-[9px] text-slate-500">Secure server-side processing</div></div></motion.div> : null}
      </AnimatePresence>
    </section>
  );
}
