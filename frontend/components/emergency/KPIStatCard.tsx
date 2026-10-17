"use client";

import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "blue" | "red" | "green" | "amber" | "teal" | "purple" | "slate";
  sublabel?: string;
};

const toneClass = {
  blue: "text-[var(--anwar-gold)]",
  red: "text-[var(--anwar-red)]",
  green: "text-[var(--anwar-green)]",
  amber: "text-[var(--anwar-gold)]",
  teal: "text-[var(--anwar-gold)]",
  purple: "text-[var(--anwar-text)]",
  slate: "text-[var(--anwar-muted)]",
};

export default function KPIStatCard({
  label,
  value,
  icon: Icon,
  tone = "blue",
  sublabel,
}: Props) {
  return (
    <div className="anwar-panel px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.12em] text-[var(--anwar-muted)]">
            {label}
          </div>
          <div className={`mt-1 font-[family-name:var(--font-heading)] text-2xl font-semibold ${toneClass[tone]}`}>{value}</div>
        </div>
        <div className={`grid h-9 w-9 place-items-center border border-current/40 ${toneClass[tone]}`}>
          <Icon size={18} />
        </div>
      </div>
      {sublabel ? <div className="mt-1 text-xs text-[var(--anwar-muted)]">{sublabel}</div> : null}
    </div>
  );
}
