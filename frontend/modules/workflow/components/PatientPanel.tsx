"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Eye, EyeOff, HeartPulse, UserRound } from "lucide-react";
import { reached, type Case, type Stage } from "@/modules/workflow/lib/caseReducer";
import type { Vitals } from "@/modules/workflow/lib/seed";

const STAGE_DOT: Record<Stage, string> = { intake: "bg-blue-500", routing: "bg-amber-500", on_scene: "bg-rose-500", admitted: "bg-emerald-500" };
export const PRIORITY_TONE: Record<string, string> = {
  P1: "border-red-300 bg-red-50 text-red-700",
  P2: "border-orange-300 bg-orange-50 text-orange-700",
  P3: "border-sky-300 bg-sky-50 text-sky-700",
};

// Out-of-range thresholds for tinting only; not clinical decision support.
const VITALS: { key: keyof Vitals; label: string; unit: string; abnormal: (v: number) => boolean }[] = [
  { key: "hr", label: "HR", unit: "bpm", abnormal: (v) => v < 50 || v > 120 },
  { key: "spo2", label: "SpO2", unit: "%", abnormal: (v) => v < 92 },
  { key: "rr", label: "RR", unit: "/min", abnormal: (v) => v < 10 || v > 28 },
  { key: "gcs", label: "GCS", unit: "", abnormal: (v) => v < 13 },
  { key: "tempC", label: "Temp", unit: "C", abnormal: (v) => v < 35.5 || v > 38.5 },
];

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Section({ title, icon, children, aside }: { title: string; icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-slate-200 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.14em] text-slate-500">{icon}{title}<span className="ml-auto normal-case tracking-normal">{aside}</span></div>
      {children}
    </section>
  );
}

export default function PatientPanel({ item, summaryBusy }: { item?: Case; summaryBusy: boolean }) {
  const [showIc, setShowIc] = useState(false);
  const timelineEnd = useRef<HTMLLIElement>(null);
  useEffect(() => { timelineEnd.current?.scrollIntoView({ block: "nearest" }); }, [item?.timeline.length]);

  if (!item) {
    return <aside data-testid="patient-panel" className="grid w-[360px] shrink-0 place-items-center border-l border-slate-200 bg-white p-6 text-center text-xs text-slate-500">No active case. Run or upload a call in Call Records.</aside>;
  }
  const { identity, responder } = item.seed;
  const vitals = responder.vitals;
  const ic = showIc ? identity.ic : identity.ic.replace(/\d{4}$/, "••••");

  return (
    <aside data-testid="patient-panel" className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white text-slate-800">
      <Section title="Patient" icon={<UserRound size={12} />} aside={<span className={`rounded border px-1.5 py-0.5 text-[10px] font-black ${PRIORITY_TONE[item.priority] ?? PRIORITY_TONE.P3}`}>{item.priority}</span>}>
        <div className="text-base font-bold text-slate-950">{identity.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-slate-600">
          IC {ic}
          <button type="button" onClick={() => setShowIc((value) => !value)} aria-label={showIc ? "Hide IC number" : "Show IC number"} className="text-slate-400 hover:text-slate-700">{showIc ? <EyeOff size={12} /> : <Eye size={12} />}</button>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">Age / sex</dt><dd className="font-semibold">{identity.age} / {identity.sex}</dd>
          <dt className="text-slate-500">Phone</dt><dd className="font-semibold">{identity.phone}</dd>
          {identity.nextOfKin ? <><dt className="text-slate-500">Next of kin</dt><dd className="font-semibold">{identity.nextOfKin}</dd></> : null}
          <dt className="text-slate-500">Conditions</dt><dd className="font-semibold">{identity.conditions.join(", ") || "None known"}</dd>
        </dl>
        {identity.allergies.length ? <div className="mt-2 flex flex-wrap gap-1">{identity.allergies.map((allergy) => <span key={allergy} className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">Allergy: {allergy}</span>)}</div> : null}
        <div className="mt-2 truncate font-mono text-[10px] text-slate-400">{item.callId}</div>
      </Section>

      {reached(item, "on_scene") ? (
        <Section title="Vitals" icon={<HeartPulse size={12} />} aside="Reported by first responder">
          <div data-testid="vitals" className="grid grid-cols-3 gap-1.5">
            <div className={`rounded-lg border p-2 ${vitals.bpSys < 90 || vitals.bpSys > 180 ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200"}`}>
              <div className="text-[9px] font-bold uppercase text-slate-500">BP</div><div className="text-sm font-black">{vitals.bpSys}/{vitals.bpDia}</div>
            </div>
            {VITALS.filter(({ key }) => vitals[key] != null).map(({ key, label, unit, abnormal }) => (
              <div key={key} className={`rounded-lg border p-2 ${abnormal(vitals[key]!) ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200"}`}>
                <div className="text-[9px] font-bold uppercase text-slate-500">{label}</div><div className="text-sm font-black">{vitals[key]}<span className="ml-0.5 text-[9px] font-semibold">{unit}</span></div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Agent summary" icon={<Bot size={12} />} aside={summaryBusy ? "updating..." : item.agentSummary ? `${item.agentSummary.offline ? "offline summary" : "AI draft"} / ${clock(item.agentSummary.at)}` : null}>
        <p data-testid="agent-summary" className={`text-xs leading-5 ${summaryBusy ? "animate-pulse text-slate-500" : "text-slate-700"}`}>{item.agentSummary?.text ?? "Generating summary..."}</p>
      </Section>

      <Section title="Timeline" icon={<span className="h-2 w-2 rounded-full bg-blue-500" />}>
        <ol data-testid="timeline" className="space-y-2">
          {item.timeline.map((event, index) => (
            <li key={index} ref={index === item.timeline.length - 1 ? timelineEnd : undefined} className="flex gap-2 text-xs">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[event.stage]}`} />
              <div className="min-w-0">
                <div className="font-semibold text-slate-900"><span className="mr-1.5 font-mono text-[10px] font-normal text-slate-400">{clock(event.at)}</span>{event.label}</div>
                {event.detail ? <div className="text-[11px] text-slate-500">{event.detail}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </aside>
  );
}
