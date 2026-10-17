"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, Ambulance, ArrowUpRight, Bot, BrainCircuit,
  CheckCircle2, Clock3, CloudRain, Cpu, Database, Hospital, LockKeyhole,
  MapPinned, RefreshCw, Route, Rows3, Send, ShieldCheck, Sparkles,
  TableProperties,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { AppPage } from "@/components/emergency/MainSidebar";
import { askCopilot } from "@/modules/dispatch-assistant/lib/api";
import type {
  ArtifactColumn, ArtifactMetric, AssistantResponse, VisualArtifact,
} from "@/modules/dispatch-assistant/types";

type Props = { selectedIncidentId?: string; onNavigate: (page: AppPage) => void };
type Conversation = { question: string; response: AssistantResponse };

const demoPrompts = [
  {
    group: "Command picture",
    icon: Activity,
    prompt: "Show all active incidents and their dispatch readiness.",
    hint: "Live incident table + operational KPIs",
  },
  {
    group: "Priority review",
    icon: AlertTriangle,
    prompt: "Which incidents need operator action now?",
    hint: "Priority and SLA attention queue",
  },
  {
    group: "Unit decision",
    icon: Ambulance,
    prompt: "Rank ambulances for INC-1002 and explain the recommendation.",
    hint: "Road ETA + capability scoring",
  },
  {
    group: "Care capacity",
    icon: Hospital,
    prompt: "Compare receiving hospitals for INC-1002.",
    hint: "ED load + accepting status",
  },
  {
    group: "Road routing",
    icon: Route,
    prompt: "Show current route ETAs and assignments.",
    hint: "Local OSRM route table",
  },
  {
    group: "Predictive layer",
    icon: CloudRain,
    prompt: "Summarize Oracle risks affecting dispatch.",
    hint: "Early-warning evidence zones",
  },
] as const;

const metricTone: Record<ArtifactMetric["tone"], string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-800",
  slate: "border-slate-200 bg-slate-50 text-slate-800",
};

export default function DispatchAssistantPage({ selectedIncidentId, onNavigate }: Props) {
  const [question, setQuestion] = useState("");
  const [sessionId, setSessionId] = useState<string>();
  const [conversation, setConversation] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation, loading]);

  const submit = async (event?: FormEvent, value = question) => {
    event?.preventDefault();
    const clean = value.trim();
    if (clean.length < 2 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await askCopilot({ question: clean, incidentId: selectedIncidentId, sessionId });
      setSessionId(response.session_id);
      setConversation((current) => [...current, { question: clean, response }]);
      setQuestion("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reach Dispatch Copilot");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setConversation([]);
    setSessionId(undefined);
    setError(null);
    setQuestion("");
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_72%_-10%,rgba(14,165,233,.13),transparent_34rem),linear-gradient(135deg,#f8fafc,#f0f9ff_48%,#f8fafc)] text-slate-800">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(14,116,144,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(14,116,144,.045)_1px,transparent_1px)] [background-size:40px_40px]" />

      <header className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200/90 bg-white/80 px-4 py-3 backdrop-blur-xl">
        <div className="relative grid h-11 w-11 place-items-center rounded-2xl border border-sky-200 bg-gradient-to-br from-blue-600 to-cyan-600 text-white shadow-[0_10px_28px_rgba(37,99,235,.24)]">
          <BrainCircuit size={21} />
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-400"><span className="absolute inset-0 animate-ping rounded-full bg-emerald-400" /></span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-black tracking-tight text-slate-950">Dispatch Copilot</h1>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-[.14em] text-blue-700">Decision intelligence</span>
          </div>
          <p className="mt-0.5 text-[10px] font-semibold text-slate-600">Live operational views, grounded AI insight, human-controlled action</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StatusPill icon={Database} label="Fixed read models" />
          <StatusPill icon={Sparkles} label="Gemini Flash Lite" accent />
          <StatusPill icon={ShieldCheck} label="Approval required" success />
          {conversation.length ? (
            <button type="button" onClick={reset} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-700" aria-label="Start a new Copilot session"><RefreshCw size={13} /></button>
          ) : null}
        </div>
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-[0_18px_55px_rgba(15,23,42,.09)] backdrop-blur">
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-2.5 text-white">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><Bot size={16} /></div>
            <div>
              <div className="text-xs font-bold">Operator conversation</div>
              <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[.13em] text-slate-400">{sessionId ?? "New secure session"}</div>
            </div>
            <div className="ml-auto flex items-center gap-2 text-[9px] font-bold text-slate-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {selectedIncidentId ? `Context: ${selectedIncidentId}` : "Full command picture"}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
            {!conversation.length ? <EmptyState onAsk={(prompt) => void submit(undefined, prompt)} /> : null}
            <AnimatePresence initial={false}>
              {conversation.map((item, index) => (
                <ConversationTurn key={`${item.response.generated_at}-${index}`} item={item} onNavigate={onNavigate} />
              ))}
            </AnimatePresence>
            {loading ? <ThinkingState /> : null}
            <div ref={endRef} />
          </div>

          {error ? <div role="alert" className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800"><AlertTriangle size={13} />{error}</div> : null}
          <form onSubmit={(event) => void submit(event)} className="shrink-0 border-t border-slate-200 bg-white/95 p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-slate-50 p-2 shadow-inner transition-within:border-blue-300">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={keyDown}
                rows={2}
                maxLength={500}
                aria-label="Ask Dispatch Copilot"
                placeholder="Ask about incidents, unit rankings, route ETAs, hospitals, or Oracle risks..."
                className="min-h-[48px] min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400"
              />
              <button aria-label="Ask Dispatch Copilot" type="submit" disabled={loading || question.trim().length < 2} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,.25)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Send size={16} /></button>
            </div>
            <div className="mt-2 flex items-center gap-2 px-1 text-[9px] font-semibold text-slate-500"><LockKeyhole size={10} />Read-only data access. Enter to send, Shift+Enter for a new line.<span className="ml-auto">{question.length}/500</span></div>
          </form>
        </div>

        <aside className="min-h-0 space-y-3 overflow-y-auto">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.07)]">
            <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#eff6ff,#ecfeff)] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-black text-slate-950"><Cpu size={16} className="text-blue-700" />Demo command deck</div>
              <p className="mt-1 text-[10px] leading-4 text-slate-600">Each prompt runs a fixed operational view and renders verified rows.</p>
            </div>
            <div className="space-y-2 p-3">
              {demoPrompts.map(({ group, icon: Icon, prompt, hint }) => (
                <button key={prompt} type="button" disabled={loading} onClick={() => void submit(undefined, prompt)} className="group w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md disabled:opacity-50">
                  <div className="flex items-start gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700 transition group-hover:bg-blue-600 group-hover:text-white"><Icon size={14} /></span>
                    <span className="min-w-0">
                      <span className="block text-[8px] font-black uppercase tracking-[.14em] text-blue-700">{group}</span>
                      <span className="mt-1 block text-xs font-bold leading-4 text-slate-900">{prompt}</span>
                      <span className="mt-1 block text-[9px] text-slate-500">{hint}</span>
                    </span>
                    <ArrowUpRight size={12} className="ml-auto shrink-0 text-slate-300 transition group-hover:text-blue-600" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[.12em] text-emerald-800"><ShieldCheck size={15} />Human decision boundary</div>
            <p className="mt-2 text-[10px] leading-5 text-emerald-950">Copilot can inspect, compare, rank, and explain. It cannot dispatch a unit, modify priority, reroute care, or notify a hospital.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function EmptyState({ onAsk }: { onAsk: (prompt: string) => void }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center py-8 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative grid h-20 w-20 place-items-center rounded-[24px] border border-sky-200 bg-[radial-gradient(circle_at_30%_20%,#fff,#e0f2fe)] text-blue-700 shadow-[0_18px_45px_rgba(14,116,144,.16)]">
        <BrainCircuit size={34} />
        <span className="absolute inset-[-8px] animate-pulse rounded-[30px] border border-sky-300/30" />
      </motion.div>
      <h2 className="mt-5 text-xl font-black tracking-tight text-slate-950">Ask the live command picture</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Copilot joins incidents, ambulance readiness, real road ETAs, hospital capacity, and predictive risks into operator-ready visual answers.</p>
      <div className="mt-6 grid w-full gap-2 sm:grid-cols-3">
        {[
          [TableProperties, "Visual answers", "Tables, rankings and KPI cards"],
          [Database, "Verified data", "Fixed server-owned read models"],
          [ShieldCheck, "Human controlled", "Recommendations never execute"],
        ].map(([Icon, title, detail]) => {
          const VisualIcon = Icon as typeof TableProperties;
          return <div key={String(title)} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm"><VisualIcon size={15} className="text-blue-700" /><div className="mt-2 text-xs font-bold text-slate-900">{String(title)}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">{String(detail)}</div></div>;
        })}
      </div>
      <button type="button" onClick={() => onAsk(demoPrompts[0].prompt)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-[0_10px_24px_rgba(37,99,235,.22)] hover:bg-blue-700"><Sparkles size={14} />Generate command overview</button>
    </div>
  );
}

function ConversationTurn({ item, onNavigate }: { item: Conversation; onNavigate: Props["onNavigate"] }) {
  const { response } = item;
  return (
    <motion.article initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-7 space-y-3">
      <div className="ml-auto max-w-[78%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-2.5 text-sm leading-5 text-white shadow-sm">{item.question}</div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.07)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[.12em] ${response.provider === "openrouter" ? "border-cyan-200 bg-cyan-50 text-cyan-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><Sparkles size={10} />{response.provider === "openrouter" ? "OpenRouter insight" : "Verified fallback"}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-[8px] font-black uppercase tracking-[.1em] text-slate-600"><Database size={10} />Fixed read model</span>
          <span className="font-mono text-[9px] text-slate-500">{response.query.id} / {response.query.row_count} rows</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-bold text-slate-500"><Clock3 size={10} />{new Date(response.generated_at).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><Bot size={15} /></div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-6 text-slate-900">{response.answer}</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">{response.rationale}</p>
            </div>
            <div className="ml-auto shrink-0 text-right"><div className="text-lg font-black text-blue-700">{Math.round(response.confidence * 100)}%</div><div className="text-[8px] font-black uppercase tracking-wider text-slate-400">Confidence</div></div>
          </div>

          <div className="mt-4 space-y-3">
            {response.artifacts.map((artifact) => <ArtifactRenderer key={artifact.id} artifact={artifact} />)}
          </div>

          {(response.recommended_unit_id || response.recommended_facility_id) ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-blue-200 bg-[linear-gradient(135deg,#eff6ff,#ecfeff)]">
              <div className="flex items-center gap-2 border-b border-blue-200 px-3 py-2 text-[9px] font-black uppercase tracking-[.14em] text-blue-800"><CheckCircle2 size={13} />Copilot recommendation / operator decision required</div>
              <div className="flex flex-wrap items-center gap-4 p-3 text-sm font-black text-slate-950">
                {response.recommended_unit_id ? <span className="inline-flex items-center gap-2"><Ambulance size={16} className="text-blue-700" />{response.recommended_unit_id}</span> : null}
                {response.recommended_facility_id ? <span className="inline-flex items-center gap-2"><Hospital size={16} className="text-cyan-700" />{response.recommended_facility_id}</span> : null}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {response.suggested_actions.map((action) => (
              <button key={action} type="button" onClick={() => onNavigate(destinationFor(action))} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-bold text-white transition hover:bg-blue-700"><ArrowUpRight size={12} />{action}</button>
            ))}
          </div>

          <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-3 py-2 text-[9px] font-black uppercase tracking-[.12em] text-slate-600">Data provenance and constraints</summary>
            <div className="border-t border-slate-200 p-3">
              <div className="flex flex-wrap gap-1.5">{response.query.data_sources.map((source) => <span key={source} className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[8px] text-slate-600">{source}</span>)}</div>
              {response.limitations.length ? <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-4 text-amber-900"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{response.limitations.join(" ")}</div> : null}
              <div className="mt-2 text-[9px] text-slate-500">Narrative model: {response.model}. Visual rows are generated by Aegis-911, not by the model.</div>
            </div>
          </details>
        </div>
      </div>
    </motion.article>
  );
}

function ArtifactRenderer({ artifact }: { artifact: VisualArtifact }) {
  if (artifact.type === "metrics" || artifact.type === "recommendation") {
    return (
      <section className={`rounded-xl border p-3 ${artifact.type === "recommendation" ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-slate-50/70"}`}>
        <ArtifactHeading artifact={artifact} icon={artifact.type === "recommendation" ? MapPinned : Rows3} />
        <div className={`mt-3 grid gap-2 ${artifact.metrics.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3"}`}>
          {artifact.metrics.map((metric) => <div key={metric.label} className={`rounded-lg border p-2.5 ${metricTone[metric.tone]}`}><div className="text-[8px] font-black uppercase tracking-[.12em] opacity-70">{metric.label}</div><div className="mt-1 text-lg font-black tracking-tight">{metric.value}</div><div className="mt-0.5 text-[9px] opacity-75">{metric.detail}</div></div>)}
        </div>
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="px-3 py-2.5"><ArtifactHeading artifact={artifact} icon={TableProperties} /></div>
      <div className="overflow-x-auto border-t border-slate-200">
        <table className="w-full min-w-[660px] border-collapse text-left">
          <thead className="bg-slate-950 text-white"><tr>{artifact.columns.map((column) => <th key={column.key} className="whitespace-nowrap px-3 py-2 text-[8px] font-black uppercase tracking-[.12em] text-slate-300">{column.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {artifact.rows.map((row, index) => <tr key={`${artifact.id}-${index}`} className="transition hover:bg-blue-50/50">{artifact.columns.map((column) => <td key={column.key} className="whitespace-nowrap px-3 py-2 text-[10px] font-semibold text-slate-700"><FormattedCell value={row[column.key]} column={column} /></td>)}</tr>)}
            {!artifact.rows.length ? <tr><td colSpan={Math.max(1, artifact.columns.length)} className="px-3 py-6 text-center text-xs text-slate-500">No matching operational rows.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ArtifactHeading({ artifact, icon: Icon }: { artifact: VisualArtifact; icon: typeof TableProperties }) {
  return <div className="flex items-start gap-2"><Icon size={14} className="mt-0.5 shrink-0 text-blue-700" /><div><h3 className="text-xs font-black text-slate-950">{artifact.title}</h3><p className="mt-0.5 text-[9px] text-slate-500">{artifact.subtitle}</p></div>{artifact.rows.length ? <span className="ml-auto rounded-full bg-slate-100 px-2 py-1 font-mono text-[8px] font-bold text-slate-600">{artifact.rows.length} rows</span> : null}</div>;
}

function FormattedCell({ value, column }: { value: unknown; column: ArtifactColumn }) {
  if (column.format === "boolean") {
    return value ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={11} />Yes</span> : <span className="text-slate-400">No</span>;
  }
  if (column.format === "priority") {
    const priority = String(value ?? "--");
    const tone = priority === "P1" ? "bg-red-600" : priority === "P2" ? "bg-orange-500" : priority === "P3" ? "bg-amber-500" : "bg-slate-500";
    return <span className={`rounded px-1.5 py-1 text-[8px] font-black text-white ${tone}`}>{priority}</span>;
  }
  if (value == null) return <span className="text-slate-400">--</span>;
  if (column.format === "minutes") return <span className="font-mono text-blue-700">{Number(value).toFixed(1)} min</span>;
  if (column.format === "distance") return <span className="font-mono">{Number(value).toFixed(1)} km</span>;
  if (column.format === "percent") return <span className="font-mono">{Number(value).toFixed(0)}%</span>;
  if (column.format === "score") return <span className="font-mono font-black text-blue-700">{Number(value).toFixed(0)}</span>;
  return String(value);
}

function ThinkingState() {
  return <div className="mb-5 flex max-w-md items-center gap-3 rounded-2xl border border-sky-200 bg-white p-3 shadow-sm"><div className="relative grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white"><BrainCircuit size={16} /><span className="absolute inset-[-4px] animate-ping rounded-xl border border-blue-300" /></div><div><div className="text-xs font-bold text-slate-900">Running verified operational view</div><div className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-500"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />Joining live rows, then generating grounded insight</div></div></div>;
}

function StatusPill({ icon: Icon, label, accent = false, success = false }: { icon: typeof Database; label: string; accent?: boolean; success?: boolean }) {
  const tone = success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : accent ? "border-cyan-200 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white text-slate-600";
  return <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[8px] font-black uppercase tracking-[.1em] lg:inline-flex ${tone}`}><Icon size={10} />{label}</span>;
}

function destinationFor(action: string): AppPage {
  const text = action.toLowerCase();
  if (text.includes("care") || text.includes("destination") || text.includes("hospital")) return "Command Center";
  if (text.includes("signal") || text.includes("oracle")) return "Live Signals";
  if (text.includes("dispatch") || text.includes("route")) return "Live Dispatch";
  return "Command Center";
}
