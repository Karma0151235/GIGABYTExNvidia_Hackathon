"use client";

import { useMemo, useState } from "react";
import { Ambulance, Building2, RadioTower, Search } from "lucide-react";
import {
  ambulances,
  hospitalName,
  hospitals,
  incidents,
  unitById,
} from "@/lib/emergencyData";
import type { AmbulanceUnit, Hospital, Incident } from "@/types/emergency";
import StatusChip from "@/components/emergency/StatusChip";

type Tab = "Incidents" | "Ambulances" | "Hospitals";

type Props = {
  selectedIncidentId?: string;
  selectedUnitId?: string;
  onSelectIncident: (id: string) => void;
  onSelectUnit: (id: string) => void;
  onSelectHospital: (id: string) => void;
  incidentsData?: Incident[];
  unitsData?: AmbulanceUnit[];
  hospitalsData?: Hospital[];
};

export default function DispatchSidebar({
  selectedIncidentId,
  selectedUnitId,
  onSelectIncident,
  onSelectUnit,
  onSelectHospital,
  incidentsData = incidents,
  unitsData = ambulances,
  hospitalsData = hospitals,
}: Props) {
  const [tab, setTab] = useState<Tab>("Incidents");
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const filteredIncidents = useMemo(
    () =>
      incidentsData.filter((incident) =>
        `${incident.id} ${incident.type} ${incident.area} ${incident.assignedUnitId ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [incidentsData, normalizedQuery],
  );
  const filteredUnits = useMemo(
    () =>
      unitsData.filter((unit) =>
        `${unit.id} ${unit.crew} ${unit.status} ${unit.equipment}`
          .toLowerCase()
          .includes(normalizedQuery),
      ),
    [normalizedQuery, unitsData],
  );
  const filteredHospitals = useMemo(
    () =>
      hospitalsData.filter((hospital) =>
        `${hospital.name} ${hospital.area}`.toLowerCase().includes(normalizedQuery),
      ),
    [hospitalsData, normalizedQuery],
  );

  return (
    <aside className="flex w-[336px] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_85%_0%,rgba(34,211,238,0.18),transparent_38%),linear-gradient(145deg,#0f172a,#172554)] p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg font-bold">
              <RadioTower size={18} className="text-cyan-300" />
              Live Dispatch
            </div>
            <div className="mt-1 text-xs leading-relaxed text-slate-400">
              Operational incidents, units and receiving facilities
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            Live
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search incidents, hospitals, ambulances..."
            className="h-10 w-full rounded-xl border border-white/10 bg-white/8 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:bg-white/10 focus:ring-2 focus:ring-cyan-400/10"
          />
        </div>
        <div className="mt-3 grid grid-cols-3 rounded-xl border border-white/10 bg-black/15 p-1">
          {(["Incidents", "Ambulances", "Hospitals"] as Tab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                tab === item ? "bg-white/12 text-cyan-200 shadow-sm" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "Incidents" ? (
          <div className="space-y-2">
            {filteredIncidents.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                assignedUnit={unitsData.find((unit) => unit.id === incident.assignedUnitId)}
                selected={incident.id === selectedIncidentId}
                onClick={() => onSelectIncident(incident.id)}
              />
            ))}
          </div>
        ) : null}
        {tab === "Ambulances" ? (
          <div className="space-y-2">
            {filteredUnits.map((unit) => (
              <AmbulanceCard
                key={unit.id}
                unit={unit}
                baseName={hospitalsData.find((hospital) => hospital.id === unit.baseHospitalId)?.name}
                selected={unit.id === selectedUnitId}
                onClick={() => onSelectUnit(unit.id)}
              />
            ))}
          </div>
        ) : null}
        {tab === "Hospitals" ? (
          <div className="space-y-2">
            {filteredHospitals.map((hospital) => (
              <HospitalCard
                key={hospital.id}
                hospital={hospital}
                onClick={() => onSelectHospital(hospital.id)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function IncidentCard({
  incident,
  assignedUnit,
  selected,
  onClick,
}: {
  incident: Incident;
  assignedUnit?: AmbulanceUnit;
  selected?: boolean;
  onClick: () => void;
}) {
  const unit = assignedUnit ?? unitById(incident.assignedUnitId);
  const progress = Math.min(100, Math.max(16, 100 - incident.minutesOpen * 2));
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition ${
        selected
          ? "border-cyan-300 bg-white shadow-[0_10px_30px_rgba(14,116,144,0.12)] ring-1 ring-cyan-100"
          : "border-slate-200 bg-white shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      }`}
    >
      {selected ? <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400 to-blue-600" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                incident.severity === "Critical"
                  ? "bg-red-900"
                  : incident.severity === "High"
                    ? "bg-red-600"
                    : incident.severity === "Medium"
                      ? "bg-amber-500"
                      : "bg-slate-400"
              }`}
            />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {incident.id}
            </span>
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-950">
            {incident.type}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {incident.area} / {incident.minutesOpen} min open
          </div>
        </div>
        <ProgressRing value={progress} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusChip label={incident.severity} />
        <StatusChip label={incident.targetStatus} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <div className={`font-semibold ${incident.allocationStatus === "recommended" ? "text-blue-700" : "text-slate-900"}`}>{unit?.id ?? "Awaiting optimization"}</div>
          <div>{incident.allocationStatus === "recommended" ? "Recommended unit" : incident.allocationStatus === "unassigned" ? "Unit allocation" : "Assigned unit"}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-900">{incident.etaAvailable !== false ? `${incident.etaMinutes.toFixed(1)} min` : "Calculating"}</div>
          <div>OSRM road ETA</div>
        </div>
      </div>
    </button>
  );
}

export function AmbulanceCard({
  unit,
  baseName,
  selected,
  onClick,
}: {
  unit: AmbulanceUnit;
  baseName?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition ${
        selected
          ? "border-cyan-300 bg-white shadow-[0_10px_30px_rgba(14,116,144,0.12)] ring-1 ring-cyan-100"
          : "border-slate-200 bg-white shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      }`}
    >
      {selected ? <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400 to-blue-600" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Ambulance size={16} className="text-blue-600" />
            {unit.id}
          </div>
          <div className="mt-1 text-xs text-slate-500">{unit.crew}</div>
        </div>
        <StatusChip label={unit.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <div className="font-semibold text-slate-900">{baseName ?? hospitalName(unit.baseHospitalId)}</div>
          <div>Current base</div>
        </div>
        <div>
          <div className="font-semibold text-slate-900">{unit.assignedIncidentId ?? "No active call"}</div>
          <div>Assigned incident</div>
        </div>
        <div>
          <div className="font-semibold text-slate-900">{unit.etaMinutes ? `${unit.etaMinutes} min` : "Ready"}</div>
          <div>Response ETA</div>
        </div>
        <div>
          <div className="font-semibold text-slate-900">{unit.distanceKm ? `${unit.distanceKm} km` : unit.equipment}</div>
          <div>{unit.distanceKm ? "Distance" : "Equipment"}</div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${unit.fuelLevel}%` }} />
      </div>
    </button>
  );
}

export function HospitalCard({
  hospital,
  onClick,
}: {
  hospital: Hospital;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Building2 size={16} className="text-teal-600" />
            {hospital.name}
          </div>
          <div className="mt-1 text-xs text-slate-500">{hospital.area}</div>
        </div>
        <StatusChip label={hospital.edCapacity > 88 ? "At risk" : "On target"} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <div className="font-semibold text-slate-900">{hospital.edCapacity}%</div>
          <div>ED capacity</div>
        </div>
        <div>
          <div className="font-semibold text-slate-900">{hospital.ambulanceBays}</div>
          <div>Ambulance bays</div>
        </div>
        <div>
          <div className="font-semibold text-slate-900">{hospital.availableUnits}</div>
          <div>Available units</div>
        </div>
        <div>
          <div className="font-semibold text-slate-900">{hospital.nearbyIncidents}</div>
          <div>Nearby incidents</div>
        </div>
      </div>
    </button>
  );
}

function ProgressRing({ value }: { value: number }) {
  const angle = `${Math.round(value * 3.6)}deg`;
  return (
    <div
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(#2563eb ${angle}, #e5e7eb 0deg)` }}
    >
      <div className="grid h-7 w-7 place-items-center rounded-full bg-white text-[10px] font-semibold text-slate-700">
        {Math.round(value)}
      </div>
    </div>
  );
}
