"use client";

import {
  AudioLines, Bot, Crosshair, HeartPulse, LayoutDashboard, ShieldCheck,
} from "lucide-react";

export type AppPage =
  | "Command Center"
  | "Live Dispatch"
  | "Ambulance Scheduling"
  | "Live Intake"
  | "Live Signals"
  | "Triage Queue"
  | "Dispatch Copilot"
  | "Care Routing";

type Props = { activePage: AppPage; onPageChange: (page: AppPage) => void };
type NavItem = { label: AppPage; icon: typeof LayoutDashboard };

const coreNavItems: NavItem[] = [
  { label: "Command Center", icon: LayoutDashboard },
  { label: "Live Dispatch", icon: Crosshair },
  { label: "Live Intake", icon: AudioLines },
  { label: "Dispatch Copilot", icon: Bot },
];

function NavButton({ item, activePage, onPageChange }: { item: NavItem } & Props) {
  const Icon = item.icon;
  const active = activePage === item.label;
  return (
    <button type="button" onClick={() => onPageChange(item.label)}
      className={`anwar-nav-button flex w-full items-center gap-3 border px-3 py-2.5 text-sm transition ${active ? "is-active" : ""}`}>
      <Icon size={18} />
      <span className="truncate">{item.label}</span>
      {item.label === "Live Intake" ? <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--anwar-cyan)]" /> : null}
    </button>
  );
}

export default function MainSidebar({ activePage, onPageChange }: Props) {
  return (
    <aside className="anwar-sidebar flex w-[264px] shrink-0 flex-col">
      <div className="border-b border-[var(--anwar-divider)] px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="anwar-brand-mark"><HeartPulse size={21} /></div>
          <div><div className="font-[family-name:var(--font-heading)] text-[23px] font-semibold tracking-[.02em] text-[var(--anwar-text)]">Aegis-911</div><div className="text-[9px] uppercase tracking-[.15em] text-[var(--anwar-muted)]">Emergency Command</div></div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="anwar-kicker px-3 pb-2">The golden minute</div>
        <div className="space-y-1">{coreNavItems.map((item) => <NavButton key={item.label} item={item} activePage={activePage} onPageChange={onPageChange} />)}</div>
      </nav>
      <div className="border-t border-[var(--anwar-divider)] p-4">
        <div className="border border-[var(--anwar-divider)] bg-[var(--anwar-bg)] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--anwar-text)]"><span className="h-2.5 w-2.5 rounded-full bg-[var(--anwar-green)]" />System online</div>
          <div className="mt-2 flex items-center justify-between text-xs text-[var(--anwar-muted)]"><span>Fusion engine / v1.4</span><ShieldCheck size={15} className="text-[var(--anwar-green)]" /></div>
        </div>
      </div>
    </aside>
  );
}
