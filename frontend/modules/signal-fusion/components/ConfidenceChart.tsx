"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { SignalCluster, SignalSource } from "../types";

const sourceLabel: Record<SignalSource, string> = {
  WEATHER: "Weather", TRAFFIC: "Traffic", CCTV: "CCTV", CALL: "999 Call",
  FIELD: "Field", RADIO: "Radio", SMS: "SMS", APP: "App",
};

const myt = (value: string) => new Intl.DateTimeFormat("en-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(value));

export default function ConfidenceChart({
  cluster,
  compact = false,
}: {
  cluster: SignalCluster;
  compact?: boolean;
}) {
  const history = cluster.confidence_history;
  const width = 440;
  const height = 120;
  const points = history.map((item, index) => ({
    ...item,
    x: history.length === 1 ? width / 2 : 18 + index * ((width - 36) / (history.length - 1)),
    y: height - 18 - (item.confidence / 100) * (height - 34),
  }));
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");

  return (
    <div className={compact ? "p-1" : "sf-panel p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[.15em] text-slate-500">Confidence and action progression</div>
          <div className="mt-1 text-sm font-bold text-slate-950">Independent evidence compounds confidence</div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase text-emerald-700">
          {cluster.confidence_trend === "decaying" ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
          {cluster.confidence_trend}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className={compact ? "h-28 min-w-[300px] w-full" : "h-32 min-w-[420px] w-full"} role="img" aria-label="Confidence progression">
          <defs>
            <linearGradient id="confidenceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity=".22" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[25, 50, 75, 100].map((line) => {
            const y = height - 18 - (line / 100) * (height - 34);
            return <line key={line} x1="18" x2={width - 18} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 5" />;
          })}
          {points.length > 1 ? <path d={`${path} L ${points.at(-1)!.x} ${height - 18} L ${points[0].x} ${height - 18} Z`} fill="url(#confidenceFill)" /> : null}
          <path d={path} fill="none" stroke="#0284c7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point) => (
            <g key={point.at}>
              <circle cx={point.x} cy={point.y} r="5" fill="#fff" stroke="#0284c7" strokeWidth="3" />
              <text x={point.x} y={point.y - 10} textAnchor="middle" fontSize="9" fontWeight="800" fill="#0f172a">{point.confidence}%</text>
              <text x={point.x} y={height - 3} textAnchor="middle" fontSize="8" fontWeight="700" fill="#64748b">{sourceLabel[point.source as SignalSource] ?? point.source}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className={compact ? "mt-2 space-y-1.5" : "mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5"}>
        {history.map((item) => (
          <div key={item.at} className={compact ? "flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5" : "rounded-lg border border-slate-200 bg-slate-50 p-2"}>
            <div className="font-mono text-[9px] text-slate-500">{myt(item.at)} MYT</div>
            <div className={compact ? "ml-auto text-right text-[10px] font-bold text-slate-800" : "mt-1 text-[10px] font-bold text-slate-800"}>{item.action}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
