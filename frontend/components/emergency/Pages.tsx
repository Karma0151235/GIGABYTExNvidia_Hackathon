"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Gauge,
  HeartPulse,
  Hospital,
  Radio,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import {
  ambulances,
  analyticsTrend,
  crewShifts,
  hospitalName,
  hospitals,
  hourlyDemand,
  incidents,
  responseRoutes,
} from "@/lib/emergencyData";
import DispatchMap from "@/components/emergency/DispatchMap";
import { DispatchRecommendationPanel } from "@/components/emergency/LiveDispatchPage";
import { AmbulanceCard, HospitalCard, IncidentCard } from "@/components/emergency/DispatchSidebar";
import KPIStatCard from "@/components/emergency/KPIStatCard";
import StatusChip from "@/components/emergency/StatusChip";
import type { DispatchAction, DispatchLocation, DispatchSnapshot, RoutingStatus } from "@/modules/live-dispatch/types";
import type { Incident, ResponseRoute } from "@/types/emergency";
import type { CommandAction, CommandIncident, CommandSnapshot } from "@/modules/command-center/types";

export type SelectionProps = {
  selectedIncidentId?: string;
  selectedUnitId?: string;
  selectedRouteId?: string;
  onSelectIncident: (id: string) => void;
  onSelectUnit: (id: string) => void;
  onSelectRoute: (id: string) => void;
  routes: ResponseRoute[];
  locations: DispatchLocation[];
  routingStatus: RoutingStatus;
  routingError: string | null;
  lastUpdated: Date | null;
  onRetryRouting: () => void;
};

export type CommandCenterDashboardProps = SelectionProps & {
  commandSnapshot: CommandSnapshot | null;
  commandConnected: boolean;
  commandError: string | null;
  busyIncidentId: string | null;
  onCommandAction: (action: CommandAction) => Promise<CommandIncident>;
  onRefreshCommand: () => void;
  dispatchSnapshot: DispatchSnapshot | null;
  busyDispatchId: string | null;
  onDispatchAction: (action: DispatchAction) => Promise<unknown>;
};

export function CommandCenterDashboard(props: CommandCenterDashboardProps) {
  const [sidePanel, setSidePanel] = useState<"incident" | "optimization">("incident");
  const stats = props.commandSnapshot?.stats;
  const commandIncidents = props.commandSnapshot?.incidents ?? [];
  const selectedCommandIncident = commandIncidents.find((item) => item.id === props.selectedIncidentId) ?? commandIncidents[0];
  const mapIncidents: Incident[] = commandIncidents.map((incident) => ({
    id: incident.id,
    type: incident.title,
    severity: incident.priority === "P1" ? "Critical" : incident.priority === "P2" ? "High" : incident.priority === "P3" ? "Medium" : "Low",
    status: incident.status === "en_route" ? "En route" : incident.status === "on_scene" ? "On scene" : incident.status === "transporting" ? "Transporting" : incident.status === "assigned" ? "Assigned" : incident.status === "resolved" ? "Completed" : "New",
    area: incident.location,
    zone: incident.owning_agency ?? "Command Center",
    coordinate: [incident.longitude, incident.latitude],
    minutesOpen: Math.max(0, Math.round((Date.now() - new Date(incident.first_reported_at).getTime()) / 60_000)),
    assignedUnitId: incident.assigned_unit_id ?? undefined,
    etaMinutes: Math.max(0, Math.ceil(incident.sla_seconds_remaining / 60)),
    targetStatus: incident.sla_status === "breached" ? "Breached" : incident.sla_status === "at_risk" ? "At risk" : "On target",
    receivingHospitalId: incident.receiving_hospital_id ?? "hkl",
  }));

  return (
    <PageFrame
      title="Command Center"
      subtitle="Emergency demand, hospital capacity, active response routes, and target performance"
      status={
        <LiveFreshness
          status={props.commandConnected ? "online" : "offline"}
          lastUpdated={props.commandSnapshot ? new Date(props.commandSnapshot.generated_at) : null}
          onRefresh={props.onRefreshCommand}
        />
      }
    >
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KPIStatCard label="Active Incidents" value={String(stats?.active_incidents ?? 0)} icon={Activity} />
        <KPIStatCard label="P1 Critical" value={String(stats?.critical_incidents ?? 0)} icon={AlertTriangle} tone="red" />
        <KPIStatCard label="Awaiting Ack" value={String(stats?.unacknowledged ?? 0)} icon={Radio} tone="amber" />
        <KPIStatCard label="Assigned" value={String(stats?.assigned_incidents ?? 0)} icon={Ambulance} tone="green" />
        <KPIStatCard label="SLA Breached" value={String(stats?.breached_sla ?? 0)} icon={Timer} tone="red" />
      </div>

      <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.4fr)_380px]">
        <div className="h-[380px] sm:h-[440px]">
          <DispatchMap {...props} incidentsData={mapIncidents} compact />
        </div>
        <aside className="min-h-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-2 border-b border-slate-200 p-1.5">
            <button type="button" onClick={() => setSidePanel("incident")} className={`rounded-lg px-3 py-2 text-xs font-bold ${sidePanel === "incident" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>Incident control</button>
            <button type="button" onClick={() => setSidePanel("optimization")} className={`rounded-lg px-3 py-2 text-xs font-bold ${sidePanel === "optimization" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>Optimization</button>
          </div>
          <div className="max-h-[388px] overflow-y-auto p-3">
            {sidePanel === "incident" ? <CommandControlPanel incident={selectedCommandIncident} routes={props.routes} locations={props.locations} busy={props.busyIncidentId === selectedCommandIncident?.id} error={props.commandError} onAction={props.onCommandAction} /> : null}
            {sidePanel === "optimization" ? <DispatchRecommendationPanel compact recommendations={props.dispatchSnapshot?.recommendations ?? []} units={props.dispatchSnapshot?.units ?? []} selectedIncidentId={props.selectedIncidentId} busyDispatchId={props.busyDispatchId} error={props.routingError} onAction={props.onDispatchAction} /> : null}
          </div>
        </aside>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-4">
        <IncidentStateCard incidents={commandIncidents} />
        <SlaLoadCard incidents={commandIncidents} />
        <PriorityLoadCard incidents={commandIncidents} />
        <TargetGauge value={stats?.target_met_percent ?? 100} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <ReceivingNetworkCard locations={props.locations} />
        <ActiveCommandIncidentTable incidents={commandIncidents} selectedId={selectedCommandIncident?.id} onSelect={props.onSelectIncident} />
      </div>
    </PageFrame>
  );
}

export function IncidentQueuePage({ onSelectIncident }: Pick<SelectionProps, "onSelectIncident">) {
  return (
    <PageFrame title="Incident Queue" subtitle="Search, filter, assign, re-route, and close emergency calls">
      <Toolbar filters={["Priority", "Status", "Zone", "Assigned"]} />
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {incidents.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            onClick={() => onSelectIncident(incident.id)}
          />
        ))}
      </div>
    </PageFrame>
  );
}

export function AmbulanceFleetPage({ onSelectUnit }: Pick<SelectionProps, "onSelectUnit">) {
  return (
    <PageFrame title="Ambulance Fleet" subtitle="Unit status, equipment type, crew assignment, and last update">
      <Toolbar filters={["Status", "Equipment", "Base", "Assigned"]} />
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {ambulances.map((unit) => (
          <AmbulanceCard key={unit.id} unit={unit} onClick={() => onSelectUnit(unit.id)} />
        ))}
      </div>
    </PageFrame>
  );
}

export function HospitalsPage() {
  return (
    <PageFrame title="Hospitals & Bases" subtitle="Emergency department capacity and ambulance bay availability">
      <div className="grid gap-3 xl:grid-cols-3">
        {hospitals.map((hospital) => (
          <HospitalCard key={hospital.id} hospital={hospital} onClick={() => undefined} />
        ))}
      </div>
    </PageFrame>
  );
}

export function CrewSchedulerPage() {
  return (
    <PageFrame title="Crew Scheduling" subtitle="Paramedic coverage, ambulance assignment, and shift planning">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {["Crews", "Ambulances", "Shifts"].map((item, index) => (
              <button
                key={item}
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${index === 2 ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {["Today", "Day", "Week", "Filter", "+ New shift"].map((item) => (
              <button key={item} type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[220px_1fr] border-t border-slate-200">
          <div className="border-r border-slate-200 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Paramedic teams
          </div>
          <div className="grid [grid-template-columns:repeat(24,minmax(0,1fr))] py-2 text-center text-xs text-slate-500">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour}>{hour}</div>
            ))}
          </div>
          {crewShifts.map((shift) => (
            <div key={shift.id} className="contents">
              <div className="flex items-center gap-3 border-r border-t border-slate-200 py-3 pr-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-sm font-semibold text-blue-700">
                  {shift.initials}
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-950">{shift.crew}</div>
                  <div className="text-xs text-slate-500">
                    {hospitalName(shift.baseHospitalId)} · {shift.unitId}
                  </div>
                </div>
              </div>
              <div className="relative border-t border-slate-200 py-3">
                <div className="h-9 rounded-lg bg-slate-50" />
                <div
                  className="absolute top-3 h-9 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"
                  style={{
                    left: `${(shift.startHour / 24) * 100}%`,
                    width: `${((shift.endHour - shift.startHour) / 24) * 100}%`,
                  }}
                >
                  {shift.label} · {shift.certifications.join(", ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

export function DispatchOptimizationPage() {
  const recommendations = responseRoutes.slice(0, 5);
  return (
    <PageFrame title="Dispatch Optimization" subtitle="Recommended assignments based on ETA, clinical priority, hospital load, and specialist availability">
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <PanelTitle icon={SlidersHorizontal} title="Planning Inputs" />
          {["Active incidents", "Available ambulances", "Hospital capacity", "Traffic conditions", "Clinical priority weighting"].map((item, index) => (
            <label key={item} className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
              <span>{item}</span>
              <input type="checkbox" defaultChecked={index < 4} className="h-4 w-4 accent-blue-600" />
            </label>
          ))}
          <div className="mt-4 space-y-2">
            {["Minimize ETA", "Prioritize critical calls", "Balance hospital load", "Reduce cross-zone dispatch", "Reserve specialist units"].map((item) => (
              <button key={item} type="button" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-700">
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <PanelTitle icon={CheckCircle2} title="Recommended Assignments" />
          <div className="grid gap-3">
            {recommendations.map((route, index) => (
              <div key={route.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-950">
                    {route.unitId} to {route.incidentId}
                  </div>
                  <StatusChip label={index < 2 ? "Critical" : "On target"} />
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  Reduce response ETA by {2 + index} minutes and keep receiving hospital capacity below alert threshold.
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <KPIStatCard label="Before ETA" value="10.4" icon={Clock} tone="amber" />
            <KPIStatCard label="After ETA" value="7.8" icon={Timer} tone="green" />
            <KPIStatCard label="Confidence" value="94%" icon={Gauge} tone="blue" />
          </div>
          <div className="mt-4 flex gap-2">
            {["Apply recommendations", "Simulate first", "Export plan"].map((item, index) => (
              <button key={item} type="button" className={`rounded-xl px-4 py-2 text-sm font-semibold ${index === 0 ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PageFrame>
  );
}

export function DispatchAssistantPage() {
  return (
    <PageFrame title="Dispatch Assistant" subtitle="Ask about active incidents, ambulance availability, hospital capacity, or dispatch recommendations">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <PanelTitle icon={Bot} title="Operator Conversation" />
          </div>
          <div className="space-y-3 p-4">
            <ChatBubble role="assistant" text="Ask about active incidents, ambulance availability, hospital capacity, or dispatch recommendations." />
            {["Which critical incidents are unassigned?", "Find the nearest ALS ambulance to INC-2048.", "Which hospital has capacity for a trauma case?"].map((text) => (
              <ChatBubble key={text} role="operator" text={text} />
            ))}
          </div>
          <div className="border-t border-slate-200 p-4">
            <input className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" placeholder="Ask the dispatch assistant..." />
          </div>
        </div>
        <div className="space-y-3">
          {["Active incidents", "Available units", "Hospital capacity", "Recent decisions", "Suggested commands"].map((item) => (
            <div key={item} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-slate-950">{item}</div>
              <div className="mt-2 text-sm text-slate-500">Current operational context is ready for assistant queries.</div>
            </div>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

export function AnalyticsPage() {
  return (
    <PageFrame title="Analytics" subtitle="Public-sector emergency response performance and demand patterns">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KPIStatCard label="Avg response time" value="7.8 min" icon={Timer} tone="green" />
        <KPIStatCard label="Target compliance" value="91.4%" icon={Gauge} tone="blue" />
        <KPIStatCard label="Handover delay" value="11.2 min" icon={Clock} tone="amber" />
        <KPIStatCard label="Utilization" value="78%" icon={Ambulance} tone="purple" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <TrendCard />
        <DemandGrid />
        <HospitalCapacityCard />
      </div>
    </PageFrame>
  );
}

export function SettingsPage() {
  return (
    <PageFrame title="Settings" subtitle="Operational preferences, notification thresholds, and map defaults">
      <div className="grid gap-3 xl:grid-cols-2">
        {["Target response threshold", "Critical call escalation", "Hospital capacity alert", "Map default layers"].map((item) => (
          <div key={item} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-950">{item}</div>
            <div className="mt-2 text-sm text-slate-500">Configured for the emergency operations console.</div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}

function PageFrame({ title, subtitle, status, children }: { title: string; subtitle: string; status?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="anwar-page h-full overflow-y-auto p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-[28px] font-semibold text-[var(--anwar-text)]">{title}</h1>
          <p className="mt-1 text-sm text-[var(--anwar-muted)]">{subtitle}</p>
        </div>
        {status}
      </div>
      {children}
    </section>
  );
}

function LiveFreshness({ status, lastUpdated, onRefresh }: {
  status: RoutingStatus;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm transition hover:-translate-y-0.5 ${
        status === "online"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : status === "loading"
            ? "border-cyan-200 bg-cyan-50 text-cyan-800"
            : "border-red-200 bg-red-50 text-red-800"
      }`}
      title="Refresh live operational snapshot"
    >
      <span className={`h-2 w-2 rounded-full ${status === "online" ? "animate-pulse bg-emerald-500" : status === "loading" ? "animate-pulse bg-cyan-500" : "bg-red-500"}`} />
      {status === "loading" ? "Refreshing live data" : lastUpdated ? `Live / updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Waiting for live data"}
    </button>
  );
}

function CommandControlPanel({ incident, routes, locations, busy, error, onAction }: {
  incident?: CommandIncident;
  routes: ResponseRoute[];
  locations: DispatchLocation[];
  busy: boolean;
  error: string | null;
  onAction: (action: CommandAction) => Promise<CommandIncident>;
}) {
  const unitIds = Array.from(new Set(routes.map((route) => route.unitId)));
  const hospitals = locations.filter((location) => location.kind === "hospital");
  const [unitId, setUnitId] = useState(unitIds[0] ?? "AMB-01");
  const [hospitalId, setHospitalId] = useState(hospitals[0]?.id ?? "hkl");
  const nextStatus: Partial<Record<CommandIncident["status"], CommandIncident["status"]>> = {
    assigned: "en_route", en_route: "on_scene", on_scene: "transporting", transporting: "resolved",
  };

  if (!incident) {
    return <div className="grid h-full place-items-center rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No promoted incidents are waiting in Command Center.</div>;
  }
  const run = (action: CommandAction) => void onAction(action).catch(() => undefined);
  const remaining = formatSla(incident.sla_seconds_remaining);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">{incident.priority} / {incident.id}</div>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{incident.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{incident.location}</p>
        </div>
        <StatusChip label={incident.sla_status === "breached" ? "Breached" : incident.sla_status === "at_risk" ? "At risk" : "On target"} />
      </div>
      <div className={`mt-3 rounded-xl border p-3 ${incident.sla_status === "breached" ? "border-red-200 bg-red-50" : "border-cyan-200 bg-cyan-50"}`}>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">SLA clock</div>
        <div className="mt-1 font-mono text-2xl font-bold text-slate-950">{remaining}</div>
        <div className="mt-1 text-xs text-slate-600">{humanize(incident.status)} / confidence {incident.confidence}% / {incident.signal_count} fused reports</div>
      </div>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-700">{incident.summary}</p>

      {incident.status === "new" ? (
        <button type="button" disabled={busy} onClick={() => run({ type: "acknowledge", incident })} className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">Acknowledge incident</button>
      ) : null}

      {incident.status === "acknowledged" ? (
        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={unitId} onChange={(event) => setUnitId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700">
              {(unitIds.length ? unitIds : ["AMB-01"]).map((id) => <option key={id}>{id}</option>)}
            </select>
            <select value={hospitalId} onChange={(event) => setHospitalId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700">
              {(hospitals.length ? hospitals : [{ id: "hkl", name: "Hospital Kuala Lumpur" }]).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </div>
          <button type="button" disabled={busy} onClick={() => run({ type: "assign", incident, unitId, hospitalId, rationale: "Operator-selected dispatch assignment" })} className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">Assign response</button>
        </div>
      ) : null}

      {nextStatus[incident.status] ? (
        <button type="button" disabled={busy} onClick={() => run({ type: "transition", incident, status: nextStatus[incident.status]! })} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">Mark {humanize(nextStatus[incident.status]!)}</button>
      ) : null}

      {!(["resolved", "cancelled"] as string[]).includes(incident.status) ? (
        <div className="mt-3 flex gap-1.5">
          {(["P1", "P2", "P3", "P4"] as const).map((priority) => (
            <button key={priority} type="button" disabled={busy || priority === incident.priority} onClick={() => run({ type: "priority", incident, priority, reason: `Operator reviewed incident and set ${priority}` })} className={`flex-1 rounded-lg border py-1.5 text-xs font-bold ${priority === incident.priority ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{priority}</button>
          ))}
        </div>
      ) : null}
      {error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-700">{error}</div> : null}
    </div>
  );
}

function IncidentStateCard({ incidents }: { incidents: CommandIncident[] }) {
  const states = ["new", "acknowledged", "assigned", "en_route", "on_scene", "transporting"] as const;
  return <MetricPanel icon={Activity} title="Incident Lifecycle">{states.map((status) => <Bar key={status} label={`${humanize(status)} (${incidents.filter((item) => item.status === status).length})`} value={(incidents.filter((item) => item.status === status).length / Math.max(1, incidents.length)) * 100} />)}</MetricPanel>;
}

function SlaLoadCard({ incidents }: { incidents: CommandIncident[] }) {
  const states = ["on_target", "at_risk", "breached"] as const;
  return <MetricPanel icon={Timer} title="SLA Distribution">{states.map((status) => <Bar key={status} label={`${humanize(status)} (${incidents.filter((item) => item.sla_status === status).length})`} value={(incidents.filter((item) => item.sla_status === status).length / Math.max(1, incidents.length)) * 100} />)}</MetricPanel>;
}

function PriorityLoadCard({ incidents }: { incidents: CommandIncident[] }) {
  const priorities = ["P1", "P2", "P3", "P4"] as const;
  return <MetricPanel icon={AlertTriangle} title="Priority Load">{priorities.map((priority) => <Bar key={priority} label={`${priority} (${incidents.filter((item) => item.priority === priority).length})`} value={(incidents.filter((item) => item.priority === priority).length / Math.max(1, incidents.length)) * 100} />)}</MetricPanel>;
}

function formatSla(seconds: number) {
  const prefix = seconds < 0 ? "+" : "";
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${prefix}${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function TrendCard({ routes }: { routes?: ResponseRoute[] } = {}) {
  const values = routes?.length ? routes.map((route) => route.etaMinutes) : analyticsTrend;
  const max = Math.max(...values, 1);
  const denominator = Math.max(1, values.length - 1);
  const points = values.map((value, index) => `${(index / denominator) * 100},${80 - (value / max) * 60}`).join(" ");
  return (
    <MetricPanel icon={BarChart3} title={routes ? "Live Route ETA" : "Response Time Trend"}>
      <svg viewBox="0 0 100 90" className="h-40 w-full">
        <polyline fill="none" stroke="#2563eb" strokeWidth="3" points={points} />
      </svg>
    </MetricPanel>
  );
}

function DemandGrid({ routes }: { routes?: ResponseRoute[] } = {}) {
  const cells = routes?.length
    ? routes.map((route) => Math.max(2, Math.min(10, Math.round(route.distanceKm))))
    : hourlyDemand.flatMap((hour) => hour.zones.slice(0, 2));
  return (
    <MetricPanel icon={Activity} title={routes ? "Live Route Distance Load" : "Hourly Incident Demand"}>
      <div className="grid grid-cols-12 gap-1">
        {cells.map((value, index) => (
          <div
            key={index}
            className="h-5 rounded"
            title={routes?.[index] ? `${routes[index].id}: ${routes[index].distanceKm.toFixed(1)} km` : undefined}
            style={{ background: `rgba(220, 38, 38, ${0.12 + value / 14})` }}
          />
        ))}
      </div>
    </MetricPanel>
  );
}

function TargetGauge({ value }: { value: number }) {
  const angle = Math.round(Math.max(0, Math.min(100, value)) * 3.6);
  return (
    <MetricPanel icon={Gauge} title="Target Response Gauge">
      <div className="grid h-40 place-items-center">
        <div className="grid h-32 w-32 place-items-center rounded-full" style={{ background: `conic-gradient(#10b981 0 ${angle}deg, #e5e7eb ${angle}deg)` }}>
          <div className="grid h-24 w-24 place-items-center rounded-full bg-white">
            <div className="text-center">
              <div className="text-2xl font-semibold text-slate-950">{value.toFixed(0)}%</div>
              <div className="text-xs text-slate-500">Target met</div>
            </div>
          </div>
        </div>
      </div>
    </MetricPanel>
  );
}

function ReceivingNetworkCard({ locations }: { locations: DispatchLocation[] }) {
  const receivingSites = locations.filter((location) => location.kind === "hospital");
  return (
    <MetricPanel icon={Hospital} title="Receiving Network">
      <div className="space-y-3">
        {receivingSites.map((location) => (
          <div key={location.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-sm font-semibold text-slate-900">{location.name}</div>
            <div className="mt-1 text-xs text-slate-500">
              {location.metadata.trauma ? "Trauma" : "General"} / {location.metadata.icu ? "ICU available" : "No ICU flag"}
            </div>
          </div>
        ))}
        {!receivingSites.length ? <div className="text-sm text-slate-500">Waiting for the live dispatch API.</div> : null}
      </div>
    </MetricPanel>
  );
}

function HospitalCapacityCard() {
  return (
    <MetricPanel icon={Hospital} title="Hospital Capacity">
      <div className="space-y-3">
        {hospitals.map((hospital) => (
          <Bar key={hospital.id} label={hospital.name} value={hospital.edCapacity} />
        ))}
      </div>
    </MetricPanel>
  );
}

function ActiveCommandIncidentTable({ incidents, selectedId, onSelect }: {
  incidents: CommandIncident[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <PanelTitle icon={HeartPulse} title="Prioritized Incident Queue" />
        <span className="text-xs font-semibold text-slate-500">Live / {incidents.length} active</span>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {['Incident', 'Priority', 'Situation', 'Location', 'SLA', 'Unit', 'Status'].map((head) => <th key={head} className="px-3 py-2 font-semibold">{head}</th>)}
            </tr>
          </thead>
          <tbody>
            {incidents.map((incident) => (
              <tr key={incident.id} onClick={() => onSelect(incident.id)} className={`cursor-pointer border-t border-slate-100 transition hover:bg-cyan-50 ${selectedId === incident.id ? "bg-cyan-50" : ""}`}>
                <td className="px-3 py-2 font-semibold text-slate-900">{incident.id}</td>
                <td className="px-3 py-2"><StatusChip label={incident.priority} /></td>
                <td className="max-w-[220px] truncate px-3 py-2 text-slate-700" title={incident.summary}>{incident.title}</td>
                <td className="max-w-[170px] truncate px-3 py-2 text-slate-600" title={incident.location}>{incident.location}</td>
                <td className={`px-3 py-2 font-mono font-semibold ${incident.sla_status === "breached" ? "text-red-700" : incident.sla_status === "at_risk" ? "text-amber-700" : "text-emerald-700"}`}>{formatSla(incident.sla_seconds_remaining)}</td>
                <td className="px-3 py-2 text-slate-600">{incident.assigned_unit_id ?? "Unassigned"}</td>
                <td className="px-3 py-2 text-slate-600">{humanize(incident.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!incidents.length ? <div className="p-8 text-center text-sm text-slate-500">No incidents have been promoted from Signal Fusion.</div> : null}
      </div>
    </div>
  );
}

function Toolbar({ filters }: { filters: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <input className="h-10 min-w-[260px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" placeholder="Search records..." />
      {filters.map((filter) => (
        <button key={filter} type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          {filter}
        </button>
      ))}
      <button type="button" className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Assign nearest unit</button>
      <button type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Re-route</button>
    </div>
  );
}

function MetricPanel({ icon: Icon, title, children }: { icon: typeof Activity; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <PanelTitle icon={Icon} title={title} />
      <div className="mt-4">{children}</div>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: typeof Activity; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
      <Icon size={17} className="text-blue-600" />
      {title}
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span className="truncate">{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ChatBubble({ role, text }: { role: "assistant" | "operator"; text: string }) {
  return (
    <div className={`flex ${role === "operator" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[72%] rounded-xl px-3 py-2 text-sm ${role === "operator" ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-700"}`}>
        {text}
      </div>
    </div>
  );
}
