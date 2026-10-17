"use client";

import {
  AlertTriangle, ArrowRight, AudioLines, Check, Eye, MapPin, Merge,
  ShieldCheck, TrendingDown, TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { mergeClusters, overrideCluster } from "../lib/api";
import type { AuditEvent, RiskAssessment, Signal, SignalCluster } from "../types";
import ConfidenceChart from "./ConfidenceChart";
import EvidenceTimeline from "./EvidenceTimeline";
import { actionTone, age, myt } from "./PredictivePrimitives";

type ClusterAction = "verify" | "promote" | "dismiss";

export default function PredictiveDetail({
  cluster,
  evidence,
  risk,
  audit,
  allAudit,
  clusters,
  now,
  busy,
  lastIncidentId,
  onAct,
  onRefresh,
  onSelectCluster,
  onError,
}: {
  cluster: SignalCluster;
  evidence: Signal[];
  risk?: RiskAssessment;
  audit: AuditEvent[];
  allAudit: AuditEvent[];
  clusters: SignalCluster[];
  now: Date | null;
  busy?: string;
  lastIncidentId?: string;
  onAct: (id: string, action: ClusterAction) => Promise<unknown>;
  onRefresh: () => Promise<void>;
  onSelectCluster: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<"brief" | "evidence" | "progress" | "audit">("brief");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideAction, setOverrideAction] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const call = evidence.find((signal) => signal.source === "CALL");
  const audioUrl = call?.id === "CALL-999-001"
    ? "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
    : typeof call?.metadata?.audio_url === "string" && call.metadata.audio_url
      ? call.metadata.audio_url
      : undefined;

  const submitOverride = async () => {
    if (overrideAction.trim().length < 4 || overrideReason.trim().length < 4) return;
    setOperationBusy(true);
    try {
      await overrideCluster(cluster.id, overrideAction, overrideReason);
      setOverrideOpen(false);
      setOverrideAction("");
      setOverrideReason("");
      await onRefresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Unable to override recommendation");
    } finally {
      setOperationBusy(false);
    }
  };

  const submitMerge = async () => {
    const target = clusters.find((item) => item.id === mergeTargetId);
    if (!target) return;
    setOperationBusy(true);
    try {
      await mergeClusters(cluster.id, target.id);
      onSelectCluster(target.id);
      await onRefresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Unable to merge clusters");
    } finally {
      setOperationBusy(false);
    }
  };

  return (
    <aside className="sf-panel flex min-h-[520px] flex-col overflow-hidden xl:min-h-0">
      <div className="shrink-0 border-b border-slate-200 bg-[radial-gradient(circle_at_100%_0%,rgba(14,165,233,.12),transparent_42%),#fff] p-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-bold text-slate-500">{cluster.id}</span>
          {cluster.priority ? <span className="rounded bg-red-600 px-1.5 py-1 text-[9px] font-black text-white">{cluster.priority}</span> : null}
          <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase ${actionTone[cluster.action_state]}`}>{cluster.action_state}</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold capitalize text-emerald-700">
            {cluster.confidence_trend === "decaying" ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
            {cluster.confidence_trend}
          </span>
        </div>
        <h2 className="mt-2 text-lg font-bold leading-6 text-slate-950">{cluster.title}</h2>
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-600"><MapPin size={13} />{cluster.location}</div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <div><div className="text-[8px] font-black uppercase text-slate-500">First seen</div><div className="mt-1 font-mono text-[10px] font-bold text-slate-900">{myt(cluster.first_seen)}</div></div>
          <div><div className="text-[8px] font-black uppercase text-slate-500">Latest</div><div className="mt-1 font-mono text-[10px] font-bold text-slate-900">{age(cluster.last_seen, now)} ago</div></div>
          <div><div className="text-[8px] font-black uppercase text-slate-500">Lead time</div><div className="mt-1 text-[10px] font-bold text-sky-700">{cluster.lead_time_minutes ?? "--"} min</div></div>
          <div><div className="text-[8px] font-black uppercase text-slate-500">SLA clock</div><div className="mt-1 font-mono text-[10px] font-bold text-red-700">{cluster.first_call_at ? age(cluster.first_call_at, now) : "Not started"}</div></div>
        </div>
      </div>

      <div className="flex shrink-0 border-b border-slate-200 px-3" role="tablist" aria-label="Incident detail views">
        {(["brief", "evidence", "progress", "audit"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            role="tab"
            aria-selected={tab === item}
            className={`border-b-2 px-3 py-3 text-[9px] font-black uppercase tracking-[.12em] ${tab === item ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            {item}{item === "evidence" ? ` (${evidence.length})` : ""}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "brief" ? (
          <div className="space-y-4">
            {risk ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.14em] text-sky-700"><Eye size={13} />Oracle anticipated this event</div>
                <p className="mt-2 text-xs leading-5 text-slate-700">Risk-zone evidence existed {cluster.lead_time_minutes} minutes before the first emergency call. All original weak signals remain attached.</p>
              </div>
            ) : null}
            <div>
              <div className="text-[9px] font-black uppercase tracking-[.14em] text-blue-700">AI consolidated brief</div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{cluster.summary}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[9px] font-black uppercase tracking-[.14em] text-emerald-700">Confidence explanation</div>
              <p className="mt-2 text-xs leading-5 text-slate-700">{cluster.confidence_explanation}</p>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-[.14em] text-slate-500">Operator-ready facts</div>
              <div className="mt-2 space-y-2">{cluster.key_facts?.map((fact) => <div key={fact} className="flex gap-2 text-xs leading-5 text-slate-700"><Check size={13} className="mt-0.5 shrink-0 text-emerald-600" />{fact}</div>)}</div>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <div className="text-[9px] font-black uppercase tracking-[.14em] text-blue-700">Recommended next action</div>
              <div className="mt-2 flex items-start gap-2 text-sm font-bold leading-5 text-slate-950"><ArrowRight size={15} className="mt-0.5 shrink-0 text-blue-600" />{cluster.recommended_action}</div>
              <div className="mt-3 text-[10px] text-slate-600">Recommendation only. Operator approval is required.</div>
            </div>
            {audioUrl ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.14em] text-slate-500"><AudioLines size={13} />Original call recording</div>
                <audio controls preload="metadata" src={audioUrl} className="mt-3 h-9 w-full" />
                <p className="mt-2 text-[10px] text-slate-500">Archived evidence / {call?.id}</p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOverrideOpen((value) => !value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50">Override recommendation</button>
              <select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 text-[10px] font-bold text-slate-700">
                <option value="">Select merge target</option>
                {clusters.filter((item) => item.id !== cluster.id).map((item) => <option key={item.id} value={item.id}>{item.id} / {item.location}</option>)}
              </select>
            </div>
            <button type="button" disabled={!mergeTargetId || operationBusy} onClick={() => void submitMerge()} className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-bold text-slate-700 disabled:opacity-40"><Merge size={12} />Merge into selected cluster with audit record</button>
            {overrideOpen ? (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <input value={overrideAction} onChange={(event) => setOverrideAction(event.target.value)} placeholder="Replacement recommended action" className="h-9 w-full rounded-lg border border-amber-200 bg-white px-3 text-xs text-slate-900" />
                <textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Operational reason for override" className="h-20 w-full resize-none rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-900" />
                <button type="button" disabled={operationBusy || overrideAction.length < 4 || overrideReason.length < 4} onClick={() => void submitOverride()} className="rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40">Record audited override</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "evidence" ? (
          <EvidenceTimeline cluster={cluster} evidence={evidence} onRefresh={onRefresh} onSelectCluster={onSelectCluster} onError={onError} />
        ) : null}

        {tab === "progress" ? <ConfidenceChart cluster={cluster} compact /> : null}

        {tab === "audit" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><ShieldCheck size={14} />Acknowledgements and overrides are immutable audit events.</div>
            {(audit.length ? audit : allAudit.slice(0, 12)).map((event) => (
              <div key={event.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase text-slate-700">{event.event_type.replaceAll("_", " ")}</span><span className="ml-auto font-mono text-[9px] text-slate-500">{myt(event.created_at)} MYT</span></div>
                <div className="mt-2 text-xs text-slate-700">{event.actor} / {event.entity_id}</div>
              </div>
            ))}
          </div>
        ) : null}

      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50/95 p-3 backdrop-blur">
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-blue-700" />
          <div>
            <div className="text-[8px] font-black uppercase tracking-[.14em] text-blue-700">Human approval boundary</div>
            <p className="mt-0.5 text-[9px] leading-4 text-slate-600">Aegis-911 recommends only. No dispatch or escalation occurs without operator approval.</p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy === cluster.id || cluster.status === "promoted" || cluster.status === "dismissed"}
            onClick={() => void onAct(cluster.id, cluster.status === "verified" ? "promote" : "verify")}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-[10px] font-bold text-white disabled:opacity-40"
          >
            <Check size={13} />{cluster.status === "verified" ? "Approve handoff" : cluster.status === "promoted" ? "Handoff approved" : "Acknowledge"}
          </button>
          <button type="button" disabled={cluster.status === "promoted"} onClick={() => void onAct(cluster.id, "dismiss")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[10px] font-bold text-red-700 disabled:opacity-40"><AlertTriangle size={13} />Dismiss as noise</button>
        </div>
        {cluster.status === "promoted" ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">Command Center handoff: {cluster.incident_id ?? lastIncidentId}</div> : null}
      </div>
    </aside>
  );
}
