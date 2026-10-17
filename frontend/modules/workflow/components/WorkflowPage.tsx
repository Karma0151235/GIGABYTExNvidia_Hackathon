"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Bot, RadioTower, ShieldCheck } from "lucide-react";
import LiveIntakePage from "@/modules/live-intake/components/LiveIntakePage";
import LiveDispatchPage from "@/components/emergency/LiveDispatchPage";
import { useLiveRouting } from "@/modules/live-dispatch/hooks/useLiveRouting";
import type { MockCallPreview } from "@/modules/live-dispatch/lib/api";
import type { DispatchAction } from "@/modules/live-dispatch/types";
import type { TriageResult } from "@/modules/signal-fusion/types";
import { agentPayload, fallbackBrief, fallbackSummary, initialState, reached, reducer, STAGES, type Tab } from "@/modules/workflow/lib/caseReducer";
import { requestAgentText } from "@/modules/workflow/lib/agent";
import { seedFor } from "@/modules/workflow/lib/seed";
import PatientPanel, { PRIORITY_TONE } from "@/modules/workflow/components/PatientPanel";
import ResponderTab from "@/modules/workflow/components/ResponderTab";
import HospitalTab from "@/modules/workflow/components/HospitalTab";

const TABS = ["Call Records", "Route", "First Responder", "Hospital"] as const;
const now = () => new Date().toISOString();

export default function WorkflowPage() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { snapshot, routes, status: routingStatus, error: routingError, lastUpdated, busyDispatchId, reload, act } = useLiveRouting();
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>();
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const [selectedRouteId, setSelectedRouteId] = useState<string>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const briefRequested = useRef(new Set<string>());
  const selected = state.selectedId ? state.cases[state.selectedId] : undefined;

  // Default the dashboard to the first scene leg once routes arrive (same as the old AppShell).
  useEffect(() => {
    if (routes.length === 0 || selectedRouteId) return;
    const route = routes.find((item) => item.leg !== "to_hospital") ?? routes[0];
    setSelectedRouteId(route.id);
    setSelectedIncidentId(route.incidentId);
    setSelectedUnitId(route.unitId);
  }, [routes, selectedRouteId]);

  // One call brief per case; template text when the LLM is unreachable.
  useEffect(() => {
    for (const item of Object.values(state.cases)) {
      if (item.callBrief || briefRequested.current.has(item.callId)) continue;
      briefRequested.current.add(item.callId);
      void requestAgentText("call_brief", agentPayload(item)).then((text) =>
        dispatch({ type: "briefReady", callId: item.callId, brief: { text: text ?? fallbackBrief(item), offline: !text, at: now() } }),
      );
    }
  }, [state.cases]);

  // Re-summarise the selected case whenever its timeline grows. The reducer drops stale replies.
  useEffect(() => {
    if (!selected || selected.agentSummary?.eventCount === selected.timeline.length) return;
    const item = selected;
    const eventCount = item.timeline.length;
    let live = true;
    const timer = window.setTimeout(async () => {
      setSummaryBusy(true);
      const text = await requestAgentText("case_summary", agentPayload(item));
      if (live) setSummaryBusy(false);
      dispatch({ type: "summaryReady", callId: item.callId, eventCount, summary: { text: text ?? fallbackSummary(item), offline: !text, at: now() } });
    }, 800);
    return () => { live = false; window.clearTimeout(timer); setSummaryBusy(false); };
  }, [selected]);

  const setTab = (tab: Tab) => dispatch({ type: "setTab", tab });
  const selectCase = useCallback((callId: string) => dispatch({ type: "selectCase", callId }), []);

  const onTriaged = useCallback((name: string, result: TriageResult) => {
    dispatch({ type: "callTriaged", name, result, seed: seedFor(name, result.summary.priority), at: now() });
  }, []);

  const openResponder = (callId: string, preview: MockCallPreview) => {
    if (!state.cases[callId]) {
      const priority = preview.incident?.priority ?? "P2";
      dispatch({ type: "incidentOpened", callId, title: preview.incident?.title ?? "Distress call", priority, location: preview.matched_place ?? preview.location_text ?? "Unknown", seed: seedFor(undefined, priority), at: now() });
    }
    if (preview.selected) {
      dispatch({ type: "routeSelected", callId, at: now(), route: { id: `PREVIEW-ROUTE-${callId}`, unitId: preview.selected.unit_id, etaMinutes: preview.selected.eta_minutes, distanceKm: preview.selected.distance_km } });
    }
    selectCase(callId);
    setTab(2);
  };

  // Clicking a live dispatch route also opens its incident as a case and moves to First Responder.
  const selectRoute = (id: string) => {
    const route = routes.find((item) => item.id === id);
    setSelectedRouteId(id);
    setSelectedIncidentId(route?.incidentId);
    setSelectedUnitId(route?.unitId);
    if (!route || route.leg === "to_hospital") return;
    const incident = snapshot?.incidents.find((item) => item.id === route.incidentId);
    if (!state.cases[route.incidentId]) {
      dispatch({ type: "incidentOpened", callId: route.incidentId, title: incident?.title ?? "Dispatch incident", priority: incident?.priority ?? "P2", location: incident?.location ?? "Unknown", seed: seedFor(undefined, incident?.priority), at: now() });
    }
    dispatch({ type: "routeSelected", callId: route.incidentId, at: now(), route: { id: route.id, unitId: route.unitId, etaMinutes: route.etaMinutes, distanceKm: route.distanceKm } });
    selectCase(route.incidentId);
    setTab(2);
  };

  const selectIncident = (id: string) => {
    const route = routes.find((item) => item.incidentId === id && item.leg !== "to_hospital");
    setSelectedIncidentId(id);
    setSelectedRouteId(route?.id);
    setSelectedUnitId(route?.unitId);
  };

  const selectUnit = (id: string) => {
    const route = routes.find((item) => item.unitId === id && item.leg !== "to_hospital");
    setSelectedUnitId(id);
    if (route) {
      setSelectedRouteId(route.id);
      setSelectedIncidentId(route.incidentId);
    }
  };

  const onDispatchAction = async (action: DispatchAction) => {
    const result = await act(action);
    if (action.type === "accept") {
      const { incident_id, id, unit_id } = action.recommendation;
      dispatch({ type: "dispatchAccepted", callId: incident_id, dispatchId: id, unitId: unit_id, at: now() });
    }
    return result;
  };

  const renderBrief = (callId: string) => {
    const brief = state.cases[callId]?.callBrief;
    if (!state.cases[callId]) return null;
    return (
      <div data-testid="call-brief" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-blue-700"><Bot size={12} />Call summary<span className="ml-auto font-semibold normal-case tracking-normal text-blue-500">{brief ? (brief.offline ? "offline summary" : "AI draft") : "generating..."}</span></div>
        <p className={`text-xs leading-5 text-slate-800 ${brief ? "" : "animate-pulse"}`}>{brief?.text ?? "Writing dispatcher brief..."}</p>
      </div>
    );
  };

  return (
    <main className="anwar-shell flex h-screen flex-col overflow-hidden">
      <header className="anwar-topbar">
        <div className="flex min-w-0 items-center gap-3">
          <RadioTower size={16} className="shrink-0 text-[var(--anwar-primary)]" />
          <span className="shrink-0 font-semibold text-[var(--anwar-text)]">Aegis-911</span>
          <select aria-label="Active case" value={state.selectedId ?? ""} onChange={(event) => selectCase(event.target.value)} className="max-w-md rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs normal-case tracking-normal text-slate-900">
            <option value="" disabled>{state.order.length ? "Choose case" : "No cases yet"}</option>
            {state.order.map((id) => { const item = state.cases[id]; return <option key={id} value={id}>{item.priority} / {item.title} / {item.location}</option>; })}
          </select>
          {selected ? <span className={`rounded border px-1.5 py-0.5 text-[10px] font-black ${PRIORITY_TONE[selected.priority] ?? PRIORITY_TONE.P3}`}>{selected.priority}</span> : null}
        </div>
        <div className="ml-auto flex items-center gap-4"><span className="hidden sm:inline">MERS 999 / KL Command</span><span className="anwar-engine"><span />{routingStatus === "online" ? "Engine live" : routingStatus === "loading" ? "Connecting" : "Routing offline"}</span><ShieldCheck size={16} /></div>
      </header>

      <nav role="tablist" className="flex shrink-0 gap-1 border-b border-slate-200 bg-white px-4">
        {TABS.map((label, index) => {
          const done = reached(selected, STAGES[index]);
          const active = state.tab === index;
          return (
            <button key={label} role="tab" aria-selected={active} type="button" onClick={() => setTab(index as Tab)} className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold ${active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-black ${done ? "bg-emerald-500 text-white" : active ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>{index + 1}</span>
              {label}
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {/* Panes stay mounted (keeps intake results and the map) and keep their size; maplibre has no resize hook. */}
          {[
            <LiveIntakePage key="calls" onOpenDispatch={(callId) => { selectCase(callId); setTab(1); }} onTriaged={onTriaged} onSelectCall={selectCase} renderBrief={renderBrief} />,
            <div key="route" className="flex h-full flex-col">
            {selected && !selected.preview?.routable && !reached(selected, "routing") ? (
              <div data-testid="route-unavailable" className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                <span className="flex-1"><b>No road route for this call.</b> {selected.preview?.reason ?? "Routing preview unavailable."}</span>
                <button type="button" onClick={() => { dispatch({ type: "routeUnavailable", callId: selected.callId, reason: selected.preview?.reason ?? "Routing offline", at: now() }); setTab(2); }} className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white">Continue to first responder &rarr;</button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
            <LiveDispatchPage
              initialCallId={selected?.preview ? selected.callId : undefined}
              routes={routes}
              locations={snapshot?.locations ?? []}
              routingStatus={routingStatus}
              routingError={routingError}
              lastUpdated={lastUpdated}
              onRetryRouting={reload}
              selectedIncidentId={selectedIncidentId}
              selectedUnitId={selectedUnitId}
              selectedRouteId={selectedRouteId}
              onSelectIncident={selectIncident}
              onSelectUnit={selectUnit}
              onSelectRoute={selectRoute}
              dispatchSnapshot={snapshot}
              busyDispatchId={busyDispatchId}
              onDispatchAction={onDispatchAction}
              onOpenResponder={openResponder}
              onSelectCall={(callId) => { if (state.cases[callId]) selectCase(callId); }}
            />
            </div>
            </div>,
            <ResponderTab key="responder" item={selected} active={state.tab === 2} dispatch={dispatch} />,
            <HospitalTab key="hospital" item={selected} snapshot={snapshot} dispatch={dispatch} />,
          ].map((pane, index) => (
            <div key={index} role="tabpanel" aria-hidden={state.tab !== index} className={`absolute inset-0 ${state.tab === index ? "" : "invisible pointer-events-none"}`}>{pane}</div>
          ))}
        </div>
        <PatientPanel item={selected} summaryBusy={summaryBusy} showAgentSummary={state.tab !== 2} />
      </div>
    </main>
  );
}
