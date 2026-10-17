"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle, AudioLines, BrainCircuit, Check, ChevronRight,
  Eye, GitMerge, MapPin, Plus, RefreshCw, Search,
  TrendingUp, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSignalFusion } from "../hooks/useSignalFusion";
import type { SignalSource } from "../types";
import OracleWatch from "./OracleWatch";
import PredictiveDetail from "./PredictiveDetail";
import {
  actionTone, Metric, myt, SourceBadge,
} from "./PredictivePrimitives";
import SignalFusionMap from "./SignalFusionMap";
import SignalIntakeModals from "./SignalIntakeModals";

export default function SignalFusionPage({ workspace = "queue" }: { workspace?: "intake" | "queue" }) {
  const { snapshot, connected, busy, error, lastHandoff, refresh, act } = useSignalFusion();
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [modal, setModal] = useState<"signal" | "triage">();
  const [operationError, setOperationError] = useState<string>();
  const [resultMessage, setResultMessage] = useState<string>();

  useEffect(() => {
    setSelectedId((current) =>
      current
      ?? snapshot.clusters.find((cluster) => cluster.id === "CL-ORACLE-001")?.id
      ?? snapshot.clusters[0]?.id
    );
  }, [snapshot.clusters]);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clusters = useMemo(
    () => snapshot.clusters.filter((cluster) =>
      cluster.status !== "dismissed"
      && (!query || `${cluster.title} ${cluster.location}`.toLowerCase().includes(query.toLowerCase()))
    ),
    [query, snapshot.clusters],
  );
  const selected = snapshot.clusters.find((cluster) => cluster.id === selectedId) ?? clusters[0];
  const evidence = useMemo(
    () => selected
      ? snapshot.signals
          .filter((signal) => signal.cluster_id === selected.id)
          .sort((left, right) =>
            new Date(left.observed_at ?? left.received_at).getTime()
            - new Date(right.observed_at ?? right.received_at).getTime()
          )
      : [],
    [selected, snapshot.signals],
  );
  const risk = snapshot.risks.find((item) => item.id === selected?.risk_zone_id)
    ?? snapshot.risks.find((item) => item.linked_cluster_id === selected?.id);
  const audit = snapshot.audit_events.filter((event) =>
    event.entity_id === selected?.id || evidence.some((signal) => signal.id === event.entity_id)
  );

  const completeIntake = async (clusterId: string, message: string) => {
    setSelectedId(clusterId);
    setModal(undefined);
    setResultMessage(message);
    await refresh();
  };

  return (
    <section className="sf-shell flex h-full min-h-0 flex-col overflow-y-auto text-slate-800 xl:overflow-hidden">
      <header className="sticky top-0 z-30 flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="relative grid h-9 w-9 place-items-center rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 text-sky-700 shadow-sm">
            <BrainCircuit size={20} />
            <span className="absolute -inset-1 animate-pulse rounded-xl border border-sky-300/20" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-950">Predictive Signal Fusion</h1>
            <p className="text-[9px] font-bold uppercase tracking-[.18em] text-slate-500">
              {workspace === "intake"
                ? "Live intake / early warning / human decision"
                : "Clustered incidents / evidence preservation"}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setModal("triage")} aria-label="Triage a 999 call" className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:px-3">
            <AudioLines size={13} /><span className="hidden sm:inline">Triage 999 call</span>
          </button>
          <button type="button" onClick={() => setModal("signal")} aria-label="Add a new signal" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-2 text-[10px] font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:px-3">
            <Plus size={13} /><span className="hidden sm:inline">Add signal</span>
          </button>
          <div className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wide ${connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            <span className="relative h-1.5 w-1.5 rounded-full bg-current"><span className="absolute inset-0 animate-ping rounded-full bg-current" /></span>
            {connected ? "Engine live" : "Deterministic local data"}
          </div>
          <button type="button" onClick={() => void refresh()} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:text-blue-700" aria-label="Refresh fusion data">
            <RefreshCw size={14} />
          </button>
          <div className="hidden font-mono text-xs font-semibold text-slate-700 lg:block">
            {now ? myt(now.toISOString()) : "--:--:--"} <span className="text-[9px] text-slate-400">MYT</span>
          </div>
        </div>
      </header>

      <div className="grid shrink-0 gap-2 px-3 pt-3 md:grid-cols-3 xl:grid-cols-[minmax(0,1.75fr)_repeat(3,minmax(130px,.45fr))]">
        <div className="md:col-span-3 xl:col-span-1">
          <OracleWatch
            risks={snapshot.risks}
            onChanged={() => void refresh()}
            onSelect={(item) => item.linked_cluster_id && setSelectedId(item.linked_cluster_id)}
          />
        </div>
        <Metric label="Fusion compression" value={`${selected?.signal_count ?? 0} -> 1`} detail="All evidence retained" icon={GitMerge} accent="#0284c7" />
        <Metric label="Oracle lead" value={`${selected?.lead_time_minutes ?? 0} min`} detail="Before first 999 call" icon={Eye} accent="#0e7490" />
        <Metric label="Confidence" value={`${selected?.confidence ?? 0}%`} detail={`${selected?.independent_sources ?? 0} source types`} icon={TrendingUp} accent="#047857" />
      </div>

      <div className="grid gap-3 p-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[260px_minmax(390px,1fr)_340px]">
        <aside className="sf-panel flex min-h-[520px] flex-col overflow-hidden xl:min-h-0">
          <div className="border-b border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-950">Clustered incident queue</h2>
                <p className="mt-0.5 text-[10px] text-slate-500">Noise reduced before operator review</p>
              </div>
              <span className="rounded-full bg-sky-50 px-2 py-1 text-[9px] font-bold text-sky-700">{clusters.length} active</span>
            </div>
            <div className="relative mt-3">
              <Search size={13} className="absolute left-3 top-2.5 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search clustered incidents" placeholder="Search location or incident" className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[10px] text-slate-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {clusters.map((cluster, index) => (
              <motion.button
                key={cluster.id}
                type="button"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => setSelectedId(cluster.id)}
                aria-pressed={selected?.id === cluster.id}
                className={`w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${selected?.id === cluster.id ? "border-blue-300 bg-blue-50 shadow-[0_10px_28px_rgba(37,99,235,.1)]" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"}`}
              >
                <div className="flex items-center gap-2">
                  {cluster.priority ? <span className="rounded bg-red-600 px-1.5 py-1 text-[9px] font-black text-white">{cluster.priority}</span> : null}
                  <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-wide ${actionTone[cluster.action_state]}`}>{cluster.action_state}</span>
                  <span className="ml-auto text-xs font-black text-sky-700">{cluster.confidence}%</span>
                </div>
                <h3 className="mt-3 text-sm font-bold leading-5 text-slate-950">{cluster.title}</h3>
                <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-600"><MapPin size={11} />{cluster.location}</div>
                <div className="mt-3 flex flex-wrap gap-1">{Object.keys(cluster.source_mix).map((source) => <SourceBadge key={source} source={source as SignalSource} />)}</div>
                <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-2 text-[9px] font-semibold text-slate-600">
                  <GitMerge size={11} className="text-sky-700" />
                  {cluster.signal_count} signals merged
                  <span className="ml-auto capitalize">{cluster.confidence_trend}</span>
                  <ChevronRight size={12} />
                </div>
              </motion.button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 xl:min-h-0">
          <div className="h-[560px] min-h-[420px] xl:h-full xl:min-h-[520px]">
            <SignalFusionMap clusters={clusters} signals={snapshot.signals} risks={snapshot.risks} selectedId={selected?.id} onSelect={setSelectedId} />
          </div>
        </main>

        {selected ? (
          <PredictiveDetail
            cluster={selected}
            evidence={evidence}
            risk={risk}
            audit={audit}
            allAudit={snapshot.audit_events}
            clusters={clusters}
            now={now}
            busy={busy}
            lastIncidentId={lastHandoff?.id}
            onAct={act}
            onRefresh={refresh}
            onSelectCluster={setSelectedId}
            onError={setOperationError}
          />
        ) : null}
      </div>

      {(error || operationError) ? (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-xs font-semibold text-red-700 shadow-xl">
          <AlertTriangle size={14} />{operationError ?? error}
          <button type="button" onClick={() => setOperationError(undefined)}><X size={14} /></button>
        </div>
      ) : null}

      <SignalIntakeModals
        mode={modal}
        onClose={() => setModal(undefined)}
        onComplete={completeIntake}
        onError={setOperationError}
      />

      {resultMessage ? (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-emerald-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <Check size={17} className="mt-0.5 text-emerald-600" />
            <div><div className="text-xs font-bold text-slate-950">Signal fused successfully</div><p className="mt-1 text-[10px] leading-4 text-slate-600">{resultMessage}</p></div>
            <button type="button" onClick={() => setResultMessage(undefined)} className="ml-auto text-slate-400"><X size={14} /></button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
