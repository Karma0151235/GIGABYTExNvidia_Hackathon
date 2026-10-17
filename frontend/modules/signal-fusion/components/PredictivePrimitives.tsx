"use client";

import { motion } from "framer-motion";
import {
  CloudRain, Eye, FileText, PhoneCall, RadioTower, TrafficCone, Video, Zap,
} from "lucide-react";
import type { SignalCluster, SignalSource } from "../types";

export const sourceConfig: Record<SignalSource, { label: string; icon: typeof Eye; className: string }> = {
  WEATHER: { label: "Weather", icon: CloudRain, className: "border-sky-200 bg-sky-50 text-sky-700" },
  TRAFFIC: { label: "Traffic", icon: TrafficCone, className: "border-amber-200 bg-amber-50 text-amber-700" },
  CCTV: { label: "CCTV", icon: Video, className: "border-slate-300 bg-slate-100 text-slate-700" },
  CALL: { label: "999 Call", icon: PhoneCall, className: "border-red-200 bg-red-50 text-red-700" },
  FIELD: { label: "Field", icon: RadioTower, className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  RADIO: { label: "Radio", icon: RadioTower, className: "border-teal-200 bg-teal-50 text-teal-700" },
  SMS: { label: "SMS", icon: FileText, className: "border-violet-200 bg-violet-50 text-violet-700" },
  APP: { label: "App", icon: Zap, className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
};

export const actionTone: Record<SignalCluster["action_state"], string> = {
  Monitor: "border-slate-200 bg-slate-50 text-slate-700",
  Staged: "border-sky-200 bg-sky-50 text-sky-700",
  "Awaiting Review": "border-amber-200 bg-amber-50 text-amber-700",
  "Incident Ready": "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export const myt = (value?: string) => value
  ? new Intl.DateTimeFormat("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value))
  : "--:--:--";

export const age = (value?: string, now?: Date | null) => {
  if (!value || !now) return "--";
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
};

export function SourceBadge({ source }: { source: SignalSource }) {
  const config = sourceConfig[source];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${config.className}`}>
      <Icon size={11} />
      {config.label}
    </span>
  );
}

export function Metric({
  label, value, detail, icon: Icon, accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Eye;
  accent: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="sf-panel relative min-h-[112px] overflow-hidden p-3">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 blur-2xl" style={{ background: accent }} />
      <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[.15em] text-slate-500">
        {label}<Icon size={15} style={{ color: accent }} />
      </div>
      <div className="mt-2 text-xl font-bold tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-[10px] text-slate-600">{detail}</div>
    </motion.div>
  );
}
