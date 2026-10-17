"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Building2, FileText, RefreshCw, Route } from "lucide-react";
import { createPreAlertDraft, fetchCareOptions, rerouteDispatch } from "@/modules/care-route-optimizer/lib/api";
import type { CareOptions, PreAlertDraft } from "@/modules/care-route-optimizer/types";
import type { DispatchSnapshot } from "@/modules/live-dispatch/types";

type Props = { selectedIncidentId?: string; dispatchSnapshot: DispatchSnapshot | null; onRefresh: () => void };

const activeStatuses = new Set(["recommended", "accepted", "en_route", "on_scene", "transporting"]);

function formatMinutes(value: number | null) {
  return value == null ? "ETA unavailable" : `${value.toFixed(1)} min`;
}

export default function CareRouteOptimizerPage({ selectedIncidentId, dispatchSnapshot, onRefresh }: Props) {
  const incidentIds = useMemo(
    () => dispatchSnapshot?.recommendations.filter((item) => activeStatuses.has(item.status)).map((item) => item.incident_id) ?? [],
    [dispatchSnapshot],
  );
  const defaultIncident = selectedIncidentId && incidentIds.includes(selectedIncidentId) ? selectedIncidentId : incidentIds[0] ?? "";
  const [incidentId, setIncidentId] = useState(defaultIncident);
  const [care, setCare] = useState<CareOptions | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  const [reason, setReason] = useState("Scenario review: destination capacity changed");
  const [evidence, setEvidence] = useState("Scenario: ED congestion reported by operations");
  const [overrideIneligible, setOverrideIneligible] = useState(false);
  const [draft, setDraft] = useState<PreAlertDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"reroute" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIncidentId(defaultIncident);
  }, [defaultIncident]);

  useEffect(() => {
    if (!incidentId) {
      setCare(null);
      return;
    }
    const controller = new AbortController();
    let ignore = false;
    setLoading(true);
    setError(null);
    setDraft(null);
    void fetchCareOptions(incidentId, controller.signal)
      .then((result) => {
        if (ignore) return;
        setCare(result);
        setSelectedFacilityId(result.current_plan?.facility.id ?? result.options.find((item) => item.eligible)?.facility.id ?? "");
        setOverrideIneligible(false);
      })
      .catch((cause: unknown) => {
        if (!ignore && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Unable to load care options");
      })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; controller.abort(); };
  }, [incidentId]);

  const recordReroute = async () => {
    if (!care || !selectedFacilityId || reason.trim().length < 4) return;
    setBusy("reroute");
    setError(null);
    try {
      await rerouteDispatch(care.dispatch_id, { facilityId: selectedFacilityId, expectedVersion: care.dispatch_version, reason: reason.trim(), disruptionEvidence: evidence.trim(), overrideIneligible });
      await fetchCareOptions(care.incident_id).then((result) => {
        setCare(result);
        setSelectedFacilityId(result.current_plan?.facility.id ?? selectedFacilityId);
      });
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record reroute");
    } finally {
      setBusy(null);
    }
  };

  const selectedOption = care?.options.find((item) => item.facility.id === selectedFacilityId);
  const requiresOverride = Boolean(selectedOption && !selectedOption.eligible);

  const requestDraft = async () => {
    if (!care) return;
    setBusy("draft");
    setError(null);
    try {
      setDraft(await createPreAlertDraft(care.dispatch_id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare pre-alert draft");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="anwar-page h-full overflow-y-auto p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Care Route Optimizer</h1>
          <p className="mt-1 text-sm text-slate-500">Compare destination suitability and record operator-approved reroutes.</p>
        </div>
        <button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw size={15} /> Refresh dispatch data</button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Route className="rounded bg-blue-600 p-0.5 text-white" size={18} /><h2 className="font-semibold text-slate-950">Destination comparison</h2></div>
            <select aria-label="Active incident" value={incidentId} onChange={(event) => setIncidentId(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" disabled={!incidentIds.length}>
              {!incidentIds.length ? <option>No active dispatch</option> : incidentIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>

          {loading ? <div className="py-16 text-center text-sm text-slate-500">Loading live destination options…</div> : null}
          {!loading && !care ? <EmptyState text={error ?? "Select an active dispatch recommendation to compare hospitals."} /> : null}
          {care ? <>
            <div className="mb-3 rounded-xl border border-blue-600 bg-blue-600 p-3 text-sm text-white">
              <span className="font-semibold">Required operational capability:</span> {care.required_capabilities.join(", ") || "General emergency care"}. Scores combine route ETA, accepting status, capability match, and ED load.
            </div>
            <div className="grid gap-3">
              {care.options.map((option) => {
                const current = option.facility.id === care.current_plan?.facility.id;
                const selected = option.facility.id === selectedFacilityId;
                return <label key={option.facility.id} className={`cursor-pointer rounded-xl border p-4 transition ${selected ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-100" : "border-slate-200 hover:border-slate-300"} ${!option.eligible ? "opacity-70" : ""}`}>
                  <input className="sr-only" type="radio" name="facility" value={option.facility.id} checked={selected} onChange={() => setSelectedFacilityId(option.facility.id)} />
                  <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 font-semibold text-slate-950"><Building2 size={16} className="rounded bg-blue-600 p-0.5 text-white" />{option.facility.name}{current ? <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Current plan</span> : null}</div><p className="mt-1 text-sm text-slate-600">{option.reason}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${option.eligible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{option.eligible ? "Eligible" : "Override required"}</span></div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><Metric label="Route ETA" value={formatMinutes(option.eta_minutes)} /><Metric label="ED load" value={`${option.facility.ed_load_percent}%`} /><Metric label="Ambulance bays" value={String(option.facility.ambulance_bays)} /></div>
                </label>;
              })}
            </div>
          </> : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2"><ArrowRightLeft size={18} className="text-amber-600" /><h2 className="font-semibold text-slate-950">Operator reroute</h2></div>
            <p className="mt-2 text-sm text-slate-600">This records a destination change and audit reason. It does not make clinical decisions.</p>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</label>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">Disruption evidence (optional)</label>
            <input value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
            {requiresOverride ? <label className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><input type="checkbox" checked={overrideIneligible} onChange={(event) => setOverrideIneligible(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />I confirm this destination is currently ineligible and require an explicit override.</label> : null}
            <button type="button" onClick={() => void recordReroute()} disabled={!care || !selectedFacilityId || reason.trim().length < 4 || (requiresOverride && !overrideIneligible) || busy !== null} className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy === "reroute" ? "Recording reroute…" : "Record operator-approved reroute"}</button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2"><FileText size={18} className="text-cyan-600" /><h2 className="font-semibold text-slate-950">Hospital pre-alert</h2></div>
            <button type="button" onClick={() => void requestDraft()} disabled={!care || busy !== null} className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{busy === "draft" ? "Preparing draft…" : "Prepare draft for review"}</button>
            {draft ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> Draft only — not sent</div><p className="mt-2 leading-6">{draft.message}</p></div> : null}
          </div>
          {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 px-2 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 font-semibold text-slate-700">{value}</div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-14 text-center text-sm text-slate-500">{text}</div>;
}
