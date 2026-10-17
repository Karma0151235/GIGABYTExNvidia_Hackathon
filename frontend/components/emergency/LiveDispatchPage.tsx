"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Ambulance,
  Navigation,
  Radio,
  Siren,
  Timer,
} from "lucide-react";
import DispatchMap from "@/components/emergency/DispatchMap";
import { fetchIngestionPreviews, previewIngestionResult, previewMockCall, type IngestionResult, type MockCallPreview } from "@/modules/live-dispatch/lib/api";
import DispatchSidebar from "@/components/emergency/DispatchSidebar";
import KPIStatCard from "@/components/emergency/KPIStatCard";
import type { DispatchAction, DispatchLocation, DispatchRecommendation, DispatchSnapshot, RoutingStatus } from "@/modules/live-dispatch/types";
import type { AmbulanceUnit, Hospital, Incident, ResponseRoute } from "@/types/emergency";

type Props = {
  initialCallId?: string;
  routes: ResponseRoute[];
  locations: DispatchLocation[];
  routingStatus: RoutingStatus;
  routingError: string | null;
  lastUpdated: Date | null;
  onRetryRouting: () => void;
  selectedIncidentId?: string;
  selectedUnitId?: string;
  selectedRouteId?: string;
  onSelectIncident: (id: string) => void;
  onSelectUnit: (id: string) => void;
  onSelectRoute: (id: string) => void;
  dispatchSnapshot: DispatchSnapshot | null;
  busyDispatchId: string | null;
  onDispatchAction: (action: DispatchAction) => Promise<unknown>;
};

export default function LiveDispatchPage({
  initialCallId,
  routes,
  routingStatus,
  routingError,
  onRetryRouting,
  selectedIncidentId,
  selectedUnitId,
  selectedRouteId,
  onSelectIncident,
  onSelectUnit,
  onSelectRoute,
  dispatchSnapshot,
  busyDispatchId,
  onDispatchAction,
}: Props) {
  const [mockLocation, setMockLocation] = useState("Puchong");
  const [mockClassification, setMockClassification] = useState<MockCallPreview["classification"]>("legit_distress");
  const [ingestionJson, setIngestionJson] = useState(JSON.stringify({
    call_id: "CALL-001", classification: "legit_distress",
    transcript: "Car accident at Bandar Sunway. Driver has an injured leg.",
    geolocation: { locality: "Bandar Sunway", address: "Bandar Sunway, Selangor" },
    incident: { title: "Road traffic accident", summary: "Driver reports a leg injury", category: "traffic_collision", priority: "P2" },
  }, null, 2));
  const [publishedPreviews, setPublishedPreviews] = useState<MockCallPreview[]>([]);
  const [selectedPublishedCallId, setSelectedPublishedCallId] = useState<string | null>(initialCallId ?? null);
  const [manualPreview, setManualPreview] = useState<MockCallPreview | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [mockBusy, setMockBusy] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const selectionTouched = useRef(Boolean(initialCallId));
  const mockPreview = manualPreview ?? publishedPreviews.find((item) => item.call_id === selectedPublishedCallId) ?? null;

  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const previews = await fetchIngestionPreviews();
        if (active) {
          setPublishedPreviews(previews);
          if (!selectionTouched.current) setSelectedPublishedCallId(previews[0]?.call_id ?? null);
          setFeedError(null);
        }
      } catch (error) {
        if (active) setFeedError(error instanceof Error ? error.message : "Could not load intake calls");
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const runPreview = async (request: () => Promise<MockCallPreview>) => {
    setMockBusy(true);
    setMockError(null);
    try {
      const result = await request();
      selectionTouched.current = true;
      if (result.revision != null && result.call_id && result.classification === "legit_distress") {
        setPublishedPreviews((current) => [result, ...current.filter((item) => item.call_id !== result.call_id)]);
        setSelectedPublishedCallId(result.call_id);
        setManualPreview(null);
      } else {
        setSelectedPublishedCallId(null);
        setManualPreview(result);
      }
    } catch (error) {
      setMockError(error instanceof Error ? error.message : "Could not preview this call");
    } finally {
      setMockBusy(false);
    }
  };

  const runMockPreview = () => runPreview(() => previewMockCall(mockLocation, mockClassification));
  const runIngestionPreview = () => runPreview(() => previewIngestionResult(JSON.parse(ingestionJson) as IngestionResult));
  const selectPublishedCall = (callId: string) => {
    selectionTouched.current = true;
    setManualPreview(null);
    setSelectedPublishedCallId(callId);
  };
  const clearPreview = () => {
    selectionTouched.current = true;
    setManualPreview(null);
    setSelectedPublishedCallId(null);
  };

  const recommendationsByIncident = new Map(
    (dispatchSnapshot?.recommendations ?? [])
      .filter((item) => !item.is_backup && !["rejected", "cancelled"].includes(item.status))
      .map((item) => [item.incident_id, item]),
  );
  const dispatchIncidents: Incident[] = (dispatchSnapshot?.incidents ?? []).map((incident) => {
    const recommendation = recommendationsByIncident.get(incident.id);
    const assignedUnitId = incident.assigned_unit_id ?? recommendation?.unit_id;
    return {
      id: incident.id, type: incident.title,
      severity: incident.priority === "P1" ? "Critical" : incident.priority === "P2" ? "High" : incident.priority === "P3" ? "Medium" : "Low",
      status: incident.status === "en_route" ? "En route" : incident.status === "on_scene" ? "On scene" : incident.status === "transporting" ? "Transporting" : incident.status === "assigned" ? "Assigned" : incident.status === "resolved" ? "Completed" : "New",
      area: incident.location, zone: "Command Center", coordinate: [incident.longitude, incident.latitude],
      minutesOpen: recommendation ? Math.max(0, Math.round((Date.now() - new Date(recommendation.recommended_at).getTime()) / 60_000)) : 0,
      assignedUnitId,
      etaMinutes: recommendation?.scene_eta_minutes ?? 0,
      etaAvailable: recommendation != null,
      allocationStatus: incident.assigned_unit_id ? "assigned" : recommendation ? "recommended" : "unassigned",
      targetStatus: incident.sla_status === "breached" ? "Breached" : incident.sla_status === "at_risk" ? "At risk" : "On target",
      receivingHospitalId: incident.receiving_hospital_id ?? recommendation?.receiving_facility_id ?? "hkl",
    };
  });
  const dispatchUnits: AmbulanceUnit[] = (dispatchSnapshot?.units ?? []).map((unit) => ({
    id: unit.id, crew: unit.crew.map((member) => member.name).join(" / "),
    status: unit.status === "available" ? "Available" : unit.status === "en_route" || unit.status === "dispatched" || unit.status === "reserved" ? "En route" : unit.status === "on_scene" ? "On scene" : unit.status === "transporting" ? "Transporting" : unit.status === "at_hospital" ? "At hospital" : "Offline",
    baseHospitalId: unit.base_facility_id ?? "hkl", coordinate: [unit.longitude, unit.latitude],
    assignedIncidentId: unit.active_incident_id ?? undefined, equipment: unit.equipment_type === "NEONATAL" ? "Neonatal" : unit.equipment_type === "ICU" ? "ICU" : unit.equipment_type === "BLS" ? "BLS" : "ALS",
    fuelLevel: unit.fuel_percent, lastUpdate: new Date(unit.location_updated_at).toLocaleTimeString(),
  }));
  const dispatchFacilities: Hospital[] = (dispatchSnapshot?.facilities ?? []).map((facility) => ({
    id: facility.id, name: facility.name, area: facility.facility_type === "hospital" ? "Receiving facility" : "Ambulance base",
    coordinate: [facility.longitude, facility.latitude], edCapacity: facility.ed_load_percent,
    ambulanceBays: facility.ambulance_bays, traumaAvailable: facility.capabilities.includes("TRAUMA"),
    icuAvailable: facility.capabilities.includes("ICU"),
    availableUnits: dispatchUnits.filter((unit) => unit.baseHospitalId === facility.id && unit.status === "Available").length,
    nearbyIncidents: dispatchIncidents.filter((incident) => incident.receivingHospitalId === facility.id).length,
  }));
  const mockRouteId = `PREVIEW-ROUTE-${mockPreview?.call_id ?? "MANUAL"}`;
  const mockIncidentId = mockPreview?.call_id ?? "MOCK-CALL-001";
  const previewSelected = mockPreview?.routable ? mockPreview.selected : undefined;
  const mapRoutes: ResponseRoute[] = previewSelected ? [{
    id: mockRouteId, unitId: previewSelected.unit_id, incidentId: mockIncidentId,
    hospitalId: "", color: "#e11d48", coordinates: previewSelected.coordinates,
    etaMinutes: previewSelected.eta_minutes, distanceKm: previewSelected.distance_km, leg: "to_scene",
  }, ...routes] : routes;
  const previewIncidents: Incident[] = [...publishedPreviews, ...(manualPreview ? [manualPreview] : [])]
    .filter((preview) => preview.routable && preview.selected && preview.incident_coordinate)
    .map((preview) => ({
      id: preview.call_id ?? "MOCK-CALL-001", type: preview.incident?.title ?? "Distress call",
      severity: preview.incident?.priority === "P1" ? "Critical" : preview.incident?.priority === "P3" ? "Medium" : preview.incident?.priority === "P4" ? "Low" : "High",
      status: "New", area: preview.matched_place ?? preview.location_text ?? "Call location",
      zone: preview.revision != null ? "Intake handoff" : "Manual preview",
      coordinate: preview.road_access_coordinate ?? preview.incident_coordinate!, minutesOpen: 0,
      assignedUnitId: preview.selected!.unit_id, etaMinutes: preview.selected!.eta_minutes,
      etaAvailable: true, allocationStatus: "recommended", targetStatus: "On target",
      receivingHospitalId: "",
    }));
  const mapIncidents: Incident[] = [...previewIncidents, ...dispatchIncidents];
  const selectIncident = (id: string) => {
    if (publishedPreviews.some((preview) => preview.call_id === id)) selectPublishedCall(id);
    else onSelectIncident(id);
  };
  const mapUnits: AmbulanceUnit[] = previewSelected ? [{
    id: previewSelected.unit_id, crew: "Simulated crew", status: "Available",
    baseHospitalId: "", coordinate: previewSelected.origin_coordinate,
    equipment: "ALS", fuelLevel: 100, lastUpdate: "Mock position",
  }, ...dispatchUnits.filter((unit) => unit.id !== previewSelected.unit_id)] : dispatchUnits;

  const kpis = useMemo(
    () => [
      { label: "Active incidents", value: String(dispatchSnapshot?.stats?.active_incidents ?? 0), icon: Activity, tone: "blue" as const },
      {
        label: "Critical calls",
        value: String(dispatchSnapshot?.incidents.filter((incident) => incident.priority === "P1").length ?? 0),
        icon: Siren,
        tone: "red" as const,
      },
      {
        label: "Available units",
        value: String(dispatchSnapshot?.stats?.available_units ?? 0),
        icon: Ambulance,
        tone: "green" as const,
      },
      { label: "Active dispatches", value: String(dispatchSnapshot?.stats?.active_dispatches ?? 0), icon: Radio, tone: "blue" as const },
      {
        label: "Avg scene ETA",
        value: dispatchSnapshot?.stats?.average_recommended_eta != null
          ? `${dispatchSnapshot.stats.average_recommended_eta.toFixed(1)} min`
          : "--",
        icon: Timer,
        tone: "amber" as const,
      },
      { label: "OSM route legs", value: String(routes.length), icon: Navigation, tone: "teal" as const },
    ],
    [dispatchSnapshot, routes],
  );

  return (
    <div className="anwar-live-dispatch flex h-full min-h-0">
      <DispatchSidebar
        incidentsData={mapIncidents}
        unitsData={mapUnits}
        hospitalsData={dispatchFacilities}
        selectedIncidentId={previewSelected ? mockIncidentId : selectedIncidentId}
        selectedUnitId={selectedUnitId}
        onSelectIncident={selectIncident}
        onSelectUnit={onSelectUnit}
        onSelectHospital={() => undefined}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">Live Intake distress calls ({publishedPreviews.length})</span>
              {publishedPreviews.length > 1 ? <button type="button" onClick={() => { selectionTouched.current = false; setManualPreview(null); setSelectedPublishedCallId(publishedPreviews[0].call_id ?? null); }} className="text-xs font-semibold text-blue-700">Follow latest</button> : null}
            </div>
            {feedError ? <p role="alert" className="mb-1 text-xs text-red-700">Could not refresh intake calls: {feedError}</p> : null}
            {publishedPreviews.length ? (
              <select aria-label="Choose distress call route" value={manualPreview ? "" : selectedPublishedCallId ?? ""} onChange={(event) => selectPublishedCall(event.target.value)} className="w-full max-w-xl rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900">
                <option value="" disabled>Choose a processed distress call</option>
                {publishedPreviews.map((preview) => <option key={preview.call_id} value={preview.call_id}>{preview.call_id} · {preview.incident?.priority ?? "Priority pending"} · {preview.matched_place ?? preview.location_text ?? "Location unresolved"} · {preview.selected ? `${preview.selected.unit_id} · ${preview.selected.eta_minutes} min` : "Route pending"}</option>)}
              </select>
            ) : <p className="text-xs text-slate-500">Process an emergency audio call in Live Intake to see its route here.</p>}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void runMockPreview(); }} className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-bold text-slate-800">Call route preview</span>
            <input aria-label="Caller location" value={mockLocation} onChange={(event) => setMockLocation(event.target.value)} placeholder="Bandar Sunway, Klang, Puchong..." className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900" />
            <select aria-label="Call classification" value={mockClassification} onChange={(event) => setMockClassification(event.target.value as MockCallPreview["classification"])} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900">
              <option value="legit_distress">Legit distress</option><option value="scam">Scam</option><option value="misc">Misc</option>
            </select>
            <button type="submit" disabled={mockBusy || !mockLocation.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{mockBusy ? "Routing..." : "Preview route"}</button>
            {mockPreview ? <button type="button" onClick={clearPreview} className="px-2 text-xs text-slate-600">Clear</button> : null}
          </form>
          <details className="mt-2 text-xs text-slate-700">
            <summary className="cursor-pointer font-semibold">Paste ingestion JSON</summary>
            <div className="mt-2 flex items-end gap-2">
              <textarea aria-label="Ingestion JSON" value={ingestionJson} onChange={(event) => setIngestionJson(event.target.value)} rows={7} spellCheck={false} className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2 font-mono text-[11px] text-slate-900" />
              <button type="button" disabled={mockBusy} onClick={() => void runIngestionPreview()} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Preview JSON route</button>
            </div>
          </details>
          {mockError ? <p role="alert" className="mt-1 text-xs text-red-700">{mockError}</p> : null}
          {mockPreview ? <p className="mt-1 text-xs text-slate-600">{previewSelected ? `${mockPreview.call_id ?? "Call"}: ${mockPreview.matched_place ?? mockPreview.location_text} · ${previewSelected.unit_id} · ${previewSelected.eta_minutes} min · ${previewSelected.distance_km} km · preview only` : mockPreview.reason}</p> : null}
        </div>
        <div className="border-b border-slate-200/80 bg-white/90 px-4 py-2.5 backdrop-blur">
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3 2xl:grid-cols-6">
            {kpis.map((kpi) => (
              <KPIStatCard key={kpi.label} {...kpi} />
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 gap-3.5 p-3.5">
          <div className="min-w-0 flex-1">
          <DispatchMap
            routes={mapRoutes}
            incidentsData={mapIncidents}
            unitsData={mapUnits}
            hospitalsData={dispatchFacilities}
            routingStatus={previewSelected ? "online" : routingStatus}
            routingError={previewSelected ? null : routingError}
            onRetryRouting={onRetryRouting}
            selectedIncidentId={previewSelected ? mockIncidentId : selectedIncidentId}
            selectedUnitId={previewSelected ? previewSelected.unit_id : selectedUnitId}
            selectedRouteId={previewSelected ? mockRouteId : selectedRouteId}
            onSelectIncident={selectIncident}
            onSelectUnit={onSelectUnit}
            onSelectRoute={onSelectRoute}
          />
          </div>
          {previewSelected ? <aside className="w-[280px] shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <h3 className="font-bold text-slate-900">{mockPreview?.incident?.title ?? "Simulated ambulance"}</h3>
            {mockPreview?.incident?.summary ? <p className="mt-1 text-xs text-slate-600">{mockPreview.incident.summary}</p> : null}
            <p className="mt-2 text-slate-700">{previewSelected.unit_id} reaches {mockPreview?.matched_place ?? mockPreview?.location_text} in {previewSelected.eta_minutes} min over {previewSelected.distance_km} km.</p>
            <p className="mt-3 text-xs text-slate-500">Local OSM road route via OSRM. Locality names identify an approximate area; provide exact coordinates for a specific address.</p>
            <p className="mt-3 text-xs font-semibold text-amber-700">Preview only. No ambulance has been dispatched.</p>
          </aside> : <DispatchRecommendationPanel
            recommendations={dispatchSnapshot?.recommendations ?? []}
            units={dispatchSnapshot?.units ?? []}
            selectedIncidentId={selectedIncidentId}
            busyDispatchId={busyDispatchId}
            error={routingError}
            onAction={onDispatchAction}
          />}
        </div>
      </section>
    </div>
  );
}

export function DispatchRecommendationPanel({ recommendations, units, selectedIncidentId, busyDispatchId, error, onAction, compact = false }: {
  recommendations: DispatchRecommendation[];
  units: DispatchSnapshot["units"];
  selectedIncidentId?: string;
  busyDispatchId: string | null;
  error: string | null;
  onAction: (action: DispatchAction) => Promise<unknown>;
  compact?: boolean;
}) {
  const recommendation = recommendations.find((item) => item.incident_id === selectedIncidentId) ?? recommendations[0];
  const [reassignUnit, setReassignUnit] = useState("");
  const run = (action: DispatchAction) => void onAction(action).catch(() => undefined);
  if (!recommendation) {
    return <aside className={`${compact ? "grid w-full" : "hidden w-[300px] xl:grid 2xl:w-[330px]"} shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 shadow-sm`}>Waiting for Command Center incidents eligible for optimization.</aside>;
  }
  const eligible = recommendation.alternatives.filter((item) => item.eligible);
  const nextStatus = recommendation.status === "accepted" ? "en_route" : recommendation.status === "en_route" ? "on_scene" : recommendation.status === "on_scene" ? "transporting" : recommendation.status === "transporting" ? "completed" : null;
  const busy = busyDispatchId === recommendation.id;
  return (
    <aside className={`${compact ? "block w-full" : "hidden w-[300px] xl:block 2xl:w-[330px]"} shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm`}>
      <div className="bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,.2),transparent_42%),linear-gradient(145deg,#0f172a,#172554)] p-4 text-white">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Optimization decision</div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div><div className="text-lg font-bold">{recommendation.incident_id}</div><div className="text-xs text-slate-400">{recommendation.priority} / {recommendation.category}</div></div>
          <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 font-mono text-sm font-bold text-cyan-200">{(recommendation.optimization_score * 100).toFixed(1)}</div>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <DecisionMetric label="Recommended unit" value={recommendation.unit_id} />
          <DecisionMetric label="Road ETA" value={`${recommendation.scene_eta_minutes.toFixed(1)} min`} />
          <DecisionMetric label="Scene distance" value={`${recommendation.scene_distance_km.toFixed(1)} km`} />
          <DecisionMetric label="Hospital leg" value={recommendation.hospital_eta_minutes ? `${recommendation.hospital_eta_minutes.toFixed(1)} min` : "--"} />
        </div>
        <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-950">{recommendation.decision_reason}</p>
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Candidate ranking</div>
          <div className="space-y-1.5">
            {eligible.slice(0, 4).map((candidate, index) => (
              <div key={candidate.unit_id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs">
                <span className="grid h-5 w-5 place-items-center rounded bg-slate-100 font-bold text-slate-600">{index + 1}</span>
                <span className="flex-1 font-semibold text-slate-800">{candidate.unit_id}</span>
                <span className="font-mono text-slate-500">{candidate.eta_minutes?.toFixed(1)}m</span>
                <span className="font-mono font-bold text-blue-700">{(candidate.score * 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
        {recommendation.status === "recommended" ? <div className="grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => run({ type: "accept", recommendation })} className="rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Accept dispatch</button><button disabled={busy} onClick={() => run({ type: "reject", recommendation, reason: "Operator rejected recommendation" })} className="rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">Reject / rerank</button></div> : null}
        {nextStatus ? <button disabled={busy} onClick={() => run({ type: "transition", recommendation, status: nextStatus })} className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold capitalize text-white hover:bg-slate-800 disabled:opacity-50">Mark {nextStatus.replaceAll("_", " ")}</button> : null}
        {!["completed", "cancelled", "rejected"].includes(recommendation.status) ? <button disabled={busy} onClick={() => run({ type: "backup", recommendation, capability: "ALS", reason: "Operator requested ALS backup" })} className="w-full rounded-xl border border-amber-200 bg-amber-50 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">Request ALS backup</button> : null}
        <div className="border-t border-slate-200 pt-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Manual reassignment</div>
          <div className="flex gap-2"><select value={reassignUnit} onChange={(event) => setReassignUnit(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-xs"><option value="">Select unit</option>{units.filter((unit) => unit.status === "available" && unit.id !== recommendation.unit_id).map((unit) => <option key={unit.id}>{unit.id}</option>)}</select><button disabled={!reassignUnit || busy} onClick={() => run({ type: "reassign", recommendation, unitId: reassignUnit, reason: "Operator manual reassignment" })} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Reassign</button></div>
        </div>
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div> : null}
      </div>
    </aside>
  );
}

function DecisionMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-sm font-bold text-slate-900">{value}</div></div>;
}
