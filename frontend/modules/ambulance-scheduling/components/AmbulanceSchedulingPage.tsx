"use client";

import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, Ambulance, Building2, CalendarClock, Check,
  ChevronLeft, ChevronRight, Clock3, Filter, Hospital, MapPin, RefreshCw,
  Save, Search, ShieldCheck, Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DispatchFacility, DispatchRecommendation, DispatchSnapshot, DispatchUnit,
} from "@/modules/live-dispatch/types";

type Props = { dispatchSnapshot: DispatchSnapshot | null; onRefresh: () => void };
type ScheduleOverride = {
  unitId: string;
  facilityId: string;
  startHour: number;
  endHour: number;
  note: string;
};

const STORAGE_KEY = "anwar.ambulance.schedule.v1";
const hours = Array.from({ length: 24 }, (_, index) => index);
const shiftPatterns = [
  { startHour: 6, endHour: 14 },
  { startHour: 7, endHour: 19 },
  { startHour: 8, endHour: 20 },
  { startHour: 14, endHour: 22 },
];

export default function AmbulanceSchedulingPage({ dispatchSnapshot, onRefresh }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const [overrides, setOverrides] = useState<Record<string, ScheduleOverride>>({});
  const [draft, setDraft] = useState<ScheduleOverride>();
  const [publishedAt, setPublishedAt] = useState<Date>();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setOverrides(JSON.parse(saved) as Record<string, ScheduleOverride>);
    } catch {
      // A restricted browser can still use the in-memory schedule.
    }
  }, []);

  const units = dispatchSnapshot?.units ?? [];
  const facilities = dispatchSnapshot?.facilities ?? [];
  const recommendations = dispatchSnapshot?.recommendations.filter((item) =>
    !item.is_backup && !["rejected", "cancelled", "completed"].includes(item.status)
  ) ?? [];
  const recommendationByUnit = new Map(recommendations.map((item) => [item.unit_id, item]));
  const facilityById = new Map(facilities.map((item) => [item.id, item]));

  const schedules = units.map((unit, index) => {
    const pattern = shiftPatterns[index % shiftPatterns.length];
    const override = overrides[unit.id];
    return {
      unit,
      facilityId: override?.facilityId ?? unit.base_facility_id ?? facilities[0]?.id ?? "",
      startHour: override?.startHour ?? pattern.startHour,
      endHour: override?.endHour ?? pattern.endHour,
      note: override?.note ?? "",
      mission: recommendationByUnit.get(unit.id),
    };
  });
  const normalized = query.trim().toLowerCase();
  const filtered = schedules.filter(({ unit, facilityId }) => {
    const facility = facilityById.get(facilityId);
    const matchesText = !normalized || `${unit.id} ${unit.callsign} ${unit.crew.map((member) => member.name).join(" ")} ${facility?.name ?? ""}`.toLowerCase().includes(normalized);
    const matchesStatus = statusFilter === "all" || unit.status === statusFilter;
    const matchesFacility = facilityFilter === "all" || facilityId === facilityFilter;
    return matchesText && matchesStatus && matchesFacility;
  });
  const selected = schedules.find((item) => item.unit.id === selectedUnitId) ?? filtered[0];
  const editorDraft = selected
    ? draft?.unitId === selected.unit.id
      ? draft
      : {
          unitId: selected.unit.id,
          facilityId: selected.facilityId,
          startHour: selected.startHour,
          endHour: selected.endHour,
          note: selected.note,
        }
    : undefined;
  const activeResponses = recommendations.filter((item) => item.status !== "recommended").length;
  const available = units.filter((unit) => unit.status === "available").length;
  const rosteredHours = schedules.reduce((total, item) => total + item.endHour - item.startHour, 0);
  const coverageGaps = facilities.filter((facility) =>
    !schedules.some((item) => item.facilityId === facility.id)
  ).length;
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;

  const changeDate = (days: number) => {
    setSelectedDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + days);
      return next;
    });
  };

  const saveDraft = () => {
    if (!editorDraft || editorDraft.endHour <= editorDraft.startHour) return;
    const next = { ...overrides, [editorDraft.unitId]: editorDraft };
    setOverrides(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* In-memory fallback. */ }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_80%_-10%,rgba(14,165,233,.12),transparent_32rem),#f8fafc] text-slate-800">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-xl">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-sky-200 bg-gradient-to-br from-blue-600 to-cyan-600 text-white shadow-[0_10px_25px_rgba(37,99,235,.2)]"><CalendarClock size={19} /></div>
        <div>
          <h1 className="text-base font-black tracking-tight text-slate-950">Ambulance Fleet Schedule</h1>
          <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.15em] text-slate-500">Crew coverage / hospital allocation / live mission timing</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {publishedAt ? <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[9px] font-bold text-emerald-700 sm:inline-flex"><Check size={11} />Published {publishedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> : null}
          <button type="button" onClick={onRefresh} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-blue-700" aria-label="Refresh live fleet"><RefreshCw size={14} /></button>
          <button type="button" onClick={() => setPublishedAt(new Date())} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-[10px] font-bold text-white shadow-sm hover:bg-blue-700"><ShieldCheck size={13} />Publish schedule</button>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-2 p-3 pb-0 md:grid-cols-5">
        <ScheduleMetric icon={Ambulance} label="Fleet rostered" value={String(units.length)} detail="Live dispatch units" tone="blue" />
        <ScheduleMetric icon={Users} label="Crew hours" value={String(rosteredHours)} detail="Scheduled today" tone="cyan" />
        <ScheduleMetric icon={Check} label="Available now" value={String(available)} detail="Ready for allocation" tone="green" />
        <ScheduleMetric icon={Activity} label="Active responses" value={String(activeResponses)} detail="Accepted or en route" tone="amber" />
        <ScheduleMetric icon={AlertTriangle} label="Coverage gaps" value={String(coverageGaps)} detail="Facilities without base unit" tone={coverageGaps ? "red" : "green"} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 p-3">
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button type="button" onClick={() => changeDate(-1)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Previous day"><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => setSelectedDate(new Date())} className="min-w-[150px] px-3 text-center text-xs font-bold text-slate-900">
            {selectedDate.toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
          </button>
          <button type="button" onClick={() => changeDate(1)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Next day"><ChevronRight size={15} /></button>
        </div>
        <div className="relative min-w-[210px] flex-1 xl:max-w-sm"><Search size={13} className="absolute left-3 top-3 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search ambulance schedule" placeholder="Search unit, crew or hospital" className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" /></div>
        <SelectFilter icon={Filter} value={statusFilter} onChange={setStatusFilter} label="Status" options={[["all", "All statuses"], ...Array.from(new Set(units.map((unit) => unit.status))).map((status) => [status, title(status)])]} />
        <SelectFilter icon={Building2} value={facilityFilter} onChange={setFacilityFilter} label="Facility" options={[["all", "All facilities"], ...facilities.map((facility) => [facility.id, facility.name])]} />
        <div className="ml-auto hidden items-center gap-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[9px] font-bold text-slate-600 2xl:flex">
          <Legend color="bg-blue-500" label="Scheduled shift" /><Legend color="bg-red-500" label="Active mission" /><Legend color="bg-emerald-500" label="Available" />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_38px_rgba(15,23,42,.08)]">
          <div className="grid grid-cols-[260px_minmax(780px,1fr)] border-b border-slate-200 bg-slate-50">
            <div className="border-r border-slate-200 px-4 py-3 text-[9px] font-black uppercase tracking-[.13em] text-slate-500">Ambulance / crew / allocation</div>
            <div className="grid [grid-template-columns:repeat(24,minmax(0,1fr))] px-2 py-3">{hours.map((hour) => <div key={hour} className="text-center font-mono text-[8px] font-bold text-slate-500">{String(hour).padStart(2, "0")}</div>)}</div>
          </div>
          <div className="h-[calc(100%-41px)] overflow-auto">
            <div className="min-w-[1040px]">
              {filtered.map((schedule, index) => (
                <ScheduleRow
                  key={schedule.unit.id}
                  schedule={schedule}
                  facility={facilityById.get(schedule.facilityId)}
                  destination={facilityById.get(schedule.mission?.receiving_facility_id ?? "")}
                  selected={selected?.unit.id === schedule.unit.id}
                  nowHour={nowHour}
                  index={index}
                  onSelect={() => { setSelectedUnitId(schedule.unit.id); setDraft(undefined); }}
                />
              ))}
              {!filtered.length ? <div className="grid h-40 place-items-center text-sm text-slate-500">No ambulance schedules match the current filters.</div> : null}
            </div>
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-[0_14px_38px_rgba(15,23,42,.08)]">
          {selected && editorDraft ? (
            <>
              <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_100%_0%,rgba(14,165,233,.16),transparent_45%),#fff] p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700"><Ambulance size={20} /></div>
                  <div><div className="text-lg font-black text-slate-950">{selected.unit.id}</div><div className="mt-0.5 text-[10px] font-semibold text-slate-500">{selected.unit.callsign} / {selected.unit.equipment_type}</div></div>
                  <StatusBadge status={selected.unit.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">{selected.unit.capabilities.map((capability) => <span key={capability} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[8px] font-black uppercase text-slate-600">{capability}</span>)}</div>
              </div>
              <div className="space-y-4 p-4">
                <div><FieldLabel icon={Users} label="Assigned crew" /><div className="mt-2 space-y-1.5">{selected.unit.crew.map((member) => <div key={member.name} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"><span className="font-bold text-slate-900">{member.name}</span><span className="text-[9px] font-semibold uppercase text-slate-500">{member.role}</span></div>)}</div></div>
                <label className="block"><FieldLabel icon={Hospital} label="Base hospital / station" /><select value={editorDraft.facilityId} onChange={(event) => setDraft({ ...editorDraft, facilityId: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold">{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2">
                  <label><FieldLabel icon={Clock3} label="Shift start" /><input type="time" value={hourToTime(editorDraft.startHour)} onChange={(event) => setDraft({ ...editorDraft, startHour: timeToHour(event.target.value) })} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-semibold" /></label>
                  <label><FieldLabel icon={Clock3} label="Shift end" /><input type="time" value={hourToTime(editorDraft.endHour)} onChange={(event) => setDraft({ ...editorDraft, endHour: timeToHour(event.target.value) })} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-semibold" /></label>
                </div>
                {editorDraft.endHour <= editorDraft.startHour ? <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[10px] font-semibold text-red-700">Shift end must be later than shift start.</div> : null}
                <label className="block"><FieldLabel icon={MapPin} label="Planning note" /><textarea value={editorDraft.note} onChange={(event) => setDraft({ ...editorDraft, note: event.target.value })} placeholder="Coverage, maintenance, or handover note" className="mt-2 h-20 w-full resize-none rounded-lg border border-slate-200 p-3 text-xs" /></label>
                {selected.mission ? <MissionCard mission={selected.mission} facility={facilityById.get(selected.mission.receiving_facility_id ?? "")} /> : <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><div className="font-bold">No active mission</div><div className="mt-1 text-[10px]">Unit remains scheduled at its allocated base.</div></div>}
                <button type="button" disabled={editorDraft.endHour <= editorDraft.startHour} onClick={saveDraft} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"><Save size={14} />Save planning change</button>
                <p className="text-center text-[9px] leading-4 text-slate-500">Scheduling changes are planning data only. Live Dispatch remains authoritative for incident assignments.</p>
              </div>
            </>
          ) : <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-500">Select an ambulance schedule to inspect or edit.</div>}
        </aside>
      </div>
    </section>
  );
}

function ScheduleRow({ schedule, facility, destination, selected, nowHour, index, onSelect }: {
  schedule: { unit: DispatchUnit; facilityId: string; startHour: number; endHour: number; note: string; mission?: DispatchRecommendation };
  facility?: DispatchFacility;
  destination?: DispatchFacility;
  selected: boolean;
  nowHour: number;
  index: number;
  onSelect: () => void;
}) {
  const missionStart = schedule.mission ? localHour(schedule.mission.recommended_at) : 0;
  const missionDuration = schedule.mission
    ? Math.max(0.8, ((schedule.mission.scene_eta_minutes ?? 0) + (schedule.mission.hospital_eta_minutes ?? 0)) / 60)
    : 0;
  return (
    <motion.button type="button" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.2) }} onClick={onSelect} className={`grid w-full grid-cols-[260px_minmax(780px,1fr)] border-b border-slate-100 text-left transition ${selected ? "bg-blue-50/70" : "bg-white hover:bg-slate-50"}`}>
      <div className={`flex min-h-[74px] items-center gap-3 border-r px-3 ${selected ? "border-blue-200" : "border-slate-200"}`}>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${selected ? "border-blue-200 bg-blue-600 text-white" : "border-slate-200 bg-slate-50 text-blue-700"}`}><Ambulance size={17} /></div>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-black text-slate-950">{schedule.unit.id}</span><StatusDot status={schedule.unit.status} /></div><div className="mt-1 truncate text-[10px] font-semibold text-slate-600">{schedule.unit.crew.map((member) => member.name).join(" / ") || "Crew pending"}</div><div className="mt-1 truncate text-[9px] text-slate-500">{facility?.name ?? "Base not assigned"}{schedule.mission ? ` -> ${destination?.name ?? schedule.mission.receiving_facility_id ?? "destination pending"}` : " / standby"}</div></div>
      </div>
      <div className="relative min-h-[74px] overflow-hidden px-2">
        <div className="absolute inset-0 grid [grid-template-columns:repeat(24,minmax(0,1fr))]">{hours.map((hour) => <div key={hour} className="border-r border-slate-100" />)}</div>
        <div className="absolute top-4 h-10 rounded-lg border border-blue-300 bg-gradient-to-r from-blue-500 to-cyan-500 px-3 py-2 text-[9px] font-bold text-white shadow-sm" style={{ left: `${(schedule.startHour / 24) * 100}%`, width: `${((schedule.endHour - schedule.startHour) / 24) * 100}%` }}>
          {hourToTime(schedule.startHour)}-{hourToTime(schedule.endHour)} / {facility?.name ?? "Unallocated"}
        </div>
        {schedule.mission ? <div className="absolute top-[43px] z-10 h-4 min-w-[90px] rounded border border-red-700 bg-red-600 px-1.5 text-[8px] font-black leading-[14px] text-white shadow" style={{ left: `${Math.min(92, (missionStart / 24) * 100)}%`, width: `${Math.max(6, (missionDuration / 24) * 100)}%` }}>{schedule.mission.incident_id} / {schedule.mission.scene_eta_minutes.toFixed(1)}m / {destination?.id ?? schedule.mission.receiving_facility_id ?? "--"}</div> : null}
        <div className="absolute inset-y-0 z-20 w-px bg-red-500/70" style={{ left: `${(nowHour / 24) * 100}%` }}><span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" /></div>
      </div>
    </motion.button>
  );
}

function MissionCard({ mission, facility }: { mission: DispatchRecommendation; facility?: DispatchFacility }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 p-3"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.12em] text-red-700"><Activity size={12} />Live mission allocation</div><div className="mt-2 flex items-center justify-between"><div><div className="text-sm font-black text-slate-950">{mission.incident_id}</div><div className="mt-1 text-[10px] text-slate-600">{title(mission.status)} / {mission.priority}</div></div><div className="text-right"><div className="font-mono text-sm font-black text-red-700">{mission.scene_eta_minutes.toFixed(1)} min</div><div className="text-[9px] text-slate-500">Road ETA</div></div></div><div className="mt-2 border-t border-red-200 pt-2 text-[10px] text-slate-700">Receiving: <strong>{facility?.name ?? mission.receiving_facility_id ?? "Pending"}</strong>{mission.hospital_eta_minutes ? ` / ${mission.hospital_eta_minutes.toFixed(1)} min hospital leg` : ""}</div></div>;
}

function ScheduleMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof Ambulance; label: string; value: string; detail: string; tone: "blue" | "cyan" | "green" | "amber" | "red" }) {
  const colors = { blue: "text-blue-700 bg-blue-50 border-blue-200", cyan: "text-cyan-700 bg-cyan-50 border-cyan-200", green: "text-emerald-700 bg-emerald-50 border-emerald-200", amber: "text-amber-700 bg-amber-50 border-amber-200", red: "text-red-700 bg-red-50 border-red-200" };
  return <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-center justify-between"><div className="text-[8px] font-black uppercase tracking-[.13em] text-slate-500">{label}</div><span className={`grid h-7 w-7 place-items-center rounded-lg border ${colors[tone]}`}><Icon size={13} /></span></div><div className="mt-1 text-xl font-black tracking-tight text-slate-950">{value}</div><div className="mt-0.5 text-[9px] text-slate-500">{detail}</div></div>;
}

function SelectFilter({ icon: Icon, value, onChange, options, label }: { icon: typeof Filter; value: string; onChange: (value: string) => void; options: string[][]; label: string }) {
  return <label className="relative"><Icon size={12} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-[145px] rounded-xl border border-slate-200 bg-white pl-8 pr-7 text-[10px] font-semibold text-slate-700">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}

function FieldLabel({ icon: Icon, label }: { icon: typeof Users; label: string }) {
  return <span className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[.13em] text-slate-500"><Icon size={11} className="text-blue-700" />{label}</span>;
}

function StatusBadge({ status }: { status: DispatchUnit["status"] }) {
  const active = ["en_route", "dispatched", "on_scene", "transporting"].includes(status);
  return <span className={`ml-auto rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-wide ${status === "available" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : active ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{title(status)}</span>;
}

function StatusDot({ status }: { status: DispatchUnit["status"] }) {
  return <span className={`h-2 w-2 rounded-full ${status === "available" ? "bg-emerald-500" : ["en_route", "dispatched", "on_scene", "transporting"].includes(status) ? "bg-red-500" : status === "offline" ? "bg-slate-400" : "bg-amber-500"}`} title={title(status)} />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</span>;
}

function title(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hourToTime(hour: number) {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToHour(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour + minute / 60;
}

function localHour(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) + Number(parts.find((part) => part.type === "minute")?.value ?? 0) / 60;
}
