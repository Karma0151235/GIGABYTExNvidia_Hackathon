"use client";

import { BedDouble, Building2 } from "lucide-react";
import { reached, type Action, type Case } from "@/modules/workflow/lib/caseReducer";
import type { DispatchSnapshot } from "@/modules/live-dispatch/types";
import { clock } from "@/modules/workflow/components/PatientPanel";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-black uppercase tracking-[.14em] text-slate-500">{label}</div><div className="mt-1 text-sm font-semibold text-slate-900">{children}</div></div>;
}

export default function HospitalTab({ item, snapshot, dispatch }: { item?: Case; snapshot: DispatchSnapshot | null; dispatch: (action: Action) => void }) {
  if (!item) return <div className="grid h-full place-items-center text-sm text-slate-500">Select a case to see hospital handover.</div>;
  const { hospital, responder } = item.seed;
  const facilityName = item.hospitalName ?? hospital.facilityName;
  const facility = snapshot?.facilities.find((entry) => entry.name.toLowerCase() === facilityName.toLowerCase());
  const admittedAt = item.timeline.find((event) => event.stage === "admitted")?.at;

  if (!reached(item, "admitted")) {
    return (
      <div className="flex h-full flex-col gap-3 p-3.5">
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <Building2 size={28} className="text-slate-400" />
          <div className="flex-1">
            <div className="text-[10px] font-black uppercase tracking-[.14em] text-slate-500">Receiving facility</div>
            <div className="text-lg font-bold text-slate-950">{facilityName}</div>
            <div className="text-xs text-slate-500">{facility ? `ED load ${facility.ed_load_percent}% / ${facility.accepting_patients ? "accepting patients" : "on diversion"}` : "Live ED load unavailable"}</div>
          </div>
          <button type="button" disabled={!reached(item, "on_scene")} onClick={() => dispatch({ type: "admit", callId: item.callId, hospitalName: facilityName, at: new Date().toISOString() })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">Admit patient</button>
        </div>
        <p className="text-sm text-slate-500">{reached(item, "on_scene") ? "Patient in transport. Admit once handed over at the ED." : "Waiting for the first responder to reach the patient."}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3.5">
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <BedDouble size={26} className="text-emerald-700" />
        <div><div className="text-lg font-bold text-emerald-950">{facilityName}</div><div className="text-xs font-semibold text-emerald-800">Admitted {admittedAt ? clock(admittedAt) : ""} / {hospital.status}</div></div>
      </div>
      <div data-testid="hospital-record" className="grid gap-3 md:grid-cols-3">
        <Field label="Ward / bed">{hospital.ward}{hospital.bed ? ` / bed ${hospital.bed}` : ""}</Field>
        <Field label="Admitting diagnosis">{hospital.admittedDiagnosis}</Field>
        <Field label="Emergency response">{item.route?.unitId ?? item.preview?.selected?.unit_id ?? "MERS 999 ambulance"} / MERS 999 crew handover</Field>
        <Field label="Treatment plan"><ul className="list-disc pl-4 text-xs font-medium">{hospital.treatment.map((step) => <li key={step}>{step}</li>)}</ul></Field>
        <Field label="Presenting symptoms"><div className="text-xs font-medium">{responder.symptoms.join(", ")}</div></Field>
        <Field label="Pre-hospital treatment"><ul className="list-disc pl-4 text-xs font-medium">{responder.treatment.map((step) => <li key={step.action}>{step.action}</li>)}</ul></Field>
      </div>
    </div>
  );
}
