"use client";

import { motion } from "framer-motion";
import {
  Check, CloudRain, Eye, RadioTower, ShieldCheck, Timer,
  TrafficCone, TrendingDown, TrendingUp, Video,
} from "lucide-react";
import { useState } from "react";
import { acknowledgeRisk } from "../lib/api";
import type { RiskAssessment } from "../types";

const levelStyle = {
  critical: "border-red-200 bg-red-50 text-red-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-slate-200 bg-slate-50 text-slate-600",
} as const;

const actionLabel = {
  monitor: "Monitor",
  notify: "Notify supervisor",
  stage_unit: "Stage nearest ambulance",
  alert_hospital: "Alert receiving hospital",
} as const;

const sourceLabel: Record<string, string> = {
  rainfall: "Weather",
  weather: "Weather",
  congestion: "Traffic",
  traffic: "Traffic",
  cctv: "CCTV",
  field: "Field",
  event: "Event",
};

const sourceIcon: Record<string, typeof CloudRain> = {
  rainfall: CloudRain,
  weather: CloudRain,
  congestion: TrafficCone,
  traffic: TrafficCone,
  cctv: Video,
  field: RadioTower,
};

const minutesLeft = (expiresAt: string) =>
  Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));

const ageMinutes = (createdAt: string) =>
  Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000));

export default function OracleWatch({
  risks,
  onChanged,
  onSelect,
}: {
  risks: RiskAssessment[];
  onChanged: () => void;
  onSelect?: (risk: RiskAssessment) => void;
}) {
  const [busyId, setBusyId] = useState<string>();
  const active = risks.filter((risk) => minutesLeft(risk.expires_at) > 0);

  const acknowledge = async (id: string) => {
    setBusyId(id);
    try {
      await acknowledgeRisk(id);
      onChanged();
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section
      className="h-full min-h-[112px] overflow-hidden rounded-2xl border border-sky-200 bg-[radial-gradient(circle_at_0%_0%,rgba(14,165,233,.14),transparent_40%),#fff] shadow-[0_12px_35px_rgba(15,23,42,.07)]"
      aria-label="Oracle early warning watch"
      aria-live="polite"
    >
      {!active.length ? (
        <div className="flex h-full min-h-[112px] items-center gap-3 px-4 text-sm text-slate-600">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-200 bg-emerald-50"><ShieldCheck size={18} className="text-emerald-600" /></div>
          <div><h2 className="font-bold text-slate-950">Oracle Watch</h2><p className="mt-1 text-xs">No active risk zones. All weak-signal feeds remain under watch.</p></div>
        </div>
      ) : active.slice(0, 1).map((risk) => (
        <motion.article
          key={risk.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex h-full min-h-[112px] flex-col md:flex-row md:items-stretch"
        >
          <div className="flex items-center gap-3 border-b border-sky-100 px-3 py-2.5 md:w-[142px] md:shrink-0 md:border-b-0 md:border-r">
            <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sky-200 bg-white text-sky-700 shadow-sm">
              <Eye size={17} />
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500"><span className="absolute inset-0 animate-ping rounded-full bg-emerald-400" /></span>
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-950">Oracle Watch</h2>
              <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{active.length} zone{active.length === 1 ? "" : "s"} live</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelect?.(risk)}
            className="min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
            aria-label={`Open ${risk.zone} ${risk.level} risk zone`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[.12em] ${levelStyle[risk.level]}`}>{risk.level} risk</span>
              <span className="font-mono text-[9px] text-slate-500">{risk.id}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-bold capitalize text-slate-600">
                {risk.confidence_trend === "decaying" ? <TrendingDown size={11} className="text-amber-600" /> : <TrendingUp size={11} className="text-emerald-600" />}
                {risk.confidence_trend}
              </span>
            </div>
            <h3 className="mt-1.5 truncate text-sm font-bold text-slate-950">{risk.zone}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {risk.evidence.slice(0, 4).map((evidence) => {
                const Icon = sourceIcon[evidence.source] ?? Eye;
                return <span key={evidence.id ?? evidence.source} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-700"><Icon size={10} className="text-sky-700" />{sourceLabel[evidence.source] ?? evidence.source}</span>;
              })}
              <span className="ml-auto inline-flex items-center gap-1 text-[9px] font-semibold text-slate-600"><Timer size={10} />{ageMinutes(risk.generated_at)}m old / {minutesLeft(risk.expires_at)}m left</span>
            </div>
          </button>

          <div className="flex items-center gap-3 border-t border-sky-100 bg-sky-50/60 px-3 py-2.5 md:w-[168px] md:shrink-0 md:flex-col md:items-stretch md:justify-center md:border-l md:border-t-0">
            <div className="flex items-center justify-between">
              <div><div className="text-[8px] font-black uppercase tracking-wider text-sky-700">Confidence</div><div className="text-lg font-black text-sky-900">{risk.confidence}%</div></div>
              <div className="max-w-[94px] text-right text-[10px] font-bold leading-4 text-slate-800">{actionLabel[risk.recommended_action]}</div>
            </div>
            {risk.acknowledged_at ? (
              <span className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[9px] font-bold text-emerald-700"><Check size={12} />Acknowledged</span>
            ) : (
              <button type="button" disabled={busyId === risk.id} onClick={() => void acknowledge(risk.id)} className="min-h-8 rounded-lg bg-blue-600 px-3 text-[9px] font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50">Acknowledge risk</button>
            )}
          </div>
        </motion.article>
      ))}
    </section>
  );
}
