import type { TriageResult } from "@/modules/signal-fusion/types";
import type { MockCallPreview } from "@/modules/live-dispatch/lib/api";
import type { PatientSeed } from "@/modules/workflow/lib/seed";
import type { DraftReport } from "@/modules/workflow/lib/clinicalReport";

// No runtime imports: caseReducer.check.ts runs this file directly under node.

export const STAGES = ["intake", "routing", "on_scene", "admitted"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { intake: "Call triaged", routing: "Ambulance routed", on_scene: "Responder on scene", admitted: "Admitted to hospital" };

export type TimelineEvent = { at: string; stage: Stage; label: string; detail?: string };
export type AgentText = { text: string; at: string; offline: boolean };

export type Case = {
  callId: string;
  sampleName?: string;
  title: string;
  priority: string;
  location: string;
  stage: Stage;
  triage?: TriageResult;
  preview?: MockCallPreview;
  route?: { id: string; unitId: string; etaMinutes: number; distanceKm: number };
  dispatchId?: string;
  seed: PatientSeed;
  photos: string[];
  vlmDraft?: DraftReport;
  hospitalName?: string;
  callBrief?: AgentText;
  agentSummary?: AgentText & { eventCount: number };
  timeline: TimelineEvent[];
};

export type Tab = 0 | 1 | 2 | 3 | 4;
export type State = { cases: Record<string, Case>; order: string[]; selectedId?: string; tab: Tab };

export type Action =
  | { type: "callTriaged"; name: string; result: TriageResult; seed: PatientSeed; at: string }
  | { type: "incidentOpened"; callId: string; title: string; priority: string; location: string; seed: PatientSeed; at: string }
  | { type: "routeSelected"; callId: string; route: NonNullable<Case["route"]>; at: string }
  | { type: "routeUnavailable"; callId: string; reason: string; at: string }
  | { type: "dispatchAccepted"; callId: string; dispatchId: string; unitId: string; at: string }
  | { type: "markOnScene"; callId: string; at: string }
  | { type: "photoAdded"; callId: string; dataUrl: string }
  | { type: "vlmDraftReady"; callId: string; draft: DraftReport; at: string }
  | { type: "admit"; callId: string; hospitalName: string; at: string }
  | { type: "briefReady"; callId: string; brief: AgentText }
  | { type: "summaryReady"; callId: string; summary: AgentText; eventCount: number }
  | { type: "selectCase"; callId: string }
  | { type: "setTab"; tab: Tab };

export const initialState: State = { cases: {}, order: [], tab: 0 };

/** "TRIAGE: CRITICAL" line plus its reason from the VLM's visual note. */
export function photoTriage(draft: DraftReport): { level: string; reason: string } {
  const lines = (draft.video_note ?? draft.image_notes[0]?.note)?.split("\n") ?? [];
  const index = lines.findIndex((line) => line.startsWith("TRIAGE: "));
  return index < 0 ? { level: "CANNOT DETERMINE", reason: "" } : { level: lines[index].slice(8).trim(), reason: (lines[index + 1] ?? "").trim() };
}

export const reached = (item: Case | undefined, stage: Stage) => item != null && STAGES.indexOf(item.stage) >= STAGES.indexOf(stage);

function advance(item: Case, stage: Stage, events: TimelineEvent[]): Case {
  return { ...item, stage: reached(item, stage) ? item.stage : stage, timeline: [...item.timeline, ...events] };
}

function addCase(state: State, item: Case): State {
  return { ...state, cases: { ...state.cases, [item.callId]: item }, order: [item.callId, ...state.order], selectedId: state.selectedId ?? item.callId };
}

export function reducer(state: State, action: Action): State {
  if (action.type === "selectCase") return state.cases[action.callId] ? { ...state, selectedId: action.callId } : state;
  if (action.type === "setTab") return { ...state, tab: action.tab };

  if (action.type === "callTriaged") {
    const { summary } = action.result;
    if (summary.call_class !== "emergency" || state.cases[summary.call_id]) return state;
    const priority = summary.priority ?? "P3";
    const complaint = summary.complaint ?? "Emergency call";
    const title = complaint.length > 70 ? `${complaint.slice(0, 67)}...` : complaint;
    return addCase(state, {
      callId: summary.call_id, sampleName: action.name, title, priority,
      location: summary.location?.text ?? "Location unresolved", stage: "intake",
      triage: action.result, preview: action.result.dispatch_preview ?? undefined, seed: action.seed, photos: [],
      timeline: [
        { at: summary.received_at, stage: "intake", label: "999 call received", detail: action.name },
        { at: action.at, stage: "intake", label: `Triaged ${priority}`, detail: title },
      ],
    });
  }

  if (action.type === "incidentOpened") {
    if (state.cases[action.callId]) return state;
    return addCase(state, {
      callId: action.callId, title: action.title, priority: action.priority, location: action.location,
      stage: "intake", seed: action.seed, photos: [],
      timeline: [{ at: action.at, stage: "intake", label: "Incident opened from dispatch board", detail: action.title }],
    });
  }

  const item = state.cases[action.callId];
  if (!item) return state;
  const put = (next: Case): State => ({ ...state, cases: { ...state.cases, [next.callId]: next } });

  switch (action.type) {
    case "routeSelected":
      if (item.route?.id === action.route.id) return state;
      return put({ ...advance(item, "routing", [{ at: action.at, stage: "routing", label: `Route selected: ${action.route.unitId}`, detail: `ETA ${action.route.etaMinutes.toFixed(1)} min / ${action.route.distanceKm.toFixed(1)} km` }]), route: action.route });
    case "routeUnavailable":
      if (reached(item, "routing")) return state;
      return put(advance(item, "routing", [{ at: action.at, stage: "routing", label: "Ambulance dispatched without road route", detail: action.reason }]));
    case "dispatchAccepted":
      if (item.dispatchId === action.dispatchId) return state;
      return put({ ...advance(item, "routing", [{ at: action.at, stage: "routing", label: `Dispatch accepted: ${action.unitId}` }]), dispatchId: action.dispatchId });
    case "markOnScene":
      if (!reached(item, "routing") || reached(item, "on_scene")) return state;
      return put(advance(item, "on_scene", [
        { at: action.at, stage: "on_scene", label: "Responder on scene", detail: item.seed.responder.symptoms.join(", ") },
        ...item.seed.responder.treatment.map((step) => ({ at: action.at, stage: "on_scene" as const, label: step.action, detail: step.at })),
      ]));
    case "photoAdded":
      return put({ ...item, photos: [...item.photos, action.dataUrl].slice(-4) });
    case "vlmDraftReady":
      return put({ ...item, vlmDraft: action.draft, timeline: [...item.timeline, { at: action.at, stage: "on_scene", label: `VLM triage: ${photoTriage(action.draft).level}`, detail: photoTriage(action.draft).reason }] });
    case "admit":
      if (!reached(item, "on_scene") || reached(item, "admitted")) return state;
      return put({ ...advance(item, "admitted", [{ at: action.at, stage: "admitted", label: `Admitted: ${action.hospitalName}`, detail: `Ward ${item.seed.hospital.ward}${item.seed.hospital.bed ? `, bed ${item.seed.hospital.bed}` : ""}` }]), hospitalName: action.hospitalName });
    case "briefReady":
      return put({ ...item, callBrief: action.brief });
    case "summaryReady":
      // Drop stale replies: only accept a summary written for the current timeline.
      return action.eventCount === item.timeline.length ? put({ ...item, agentSummary: { ...action.summary, eventCount: action.eventCount } }) : state;
  }
}

/** Facts sent to the LLM. IC and phone stay out of the prompt. */
export function agentPayload(item: Case) {
  const { identity, responder, hospital } = item.seed;
  const { transcript, ...triage } = item.triage?.summary ?? { transcript: "" };
  return {
    callId: item.callId, title: item.title, priority: item.priority, location: item.location, stage: STAGE_LABEL[item.stage],
    transcript: transcript.slice(0, 4000), triage,
    patient: { age: identity.age, sex: identity.sex, allergies: identity.allergies, conditions: identity.conditions },
    route: item.route ?? null,
    responder: reached(item, "on_scene") ? responder : null,
    photoFindings: item.vlmDraft ? [item.vlmDraft.video_note, ...item.vlmDraft.image_notes.map((entry) => entry.note)].filter((note): note is string => Boolean(note)) : null,
    hospital: reached(item, "admitted") ? { ...hospital, facilityName: item.hospitalName } : null,
    timeline: item.timeline.map((event) => event.label),
  };
}

const NEXT_STEP: Record<Stage, string> = {
  intake: "Next: select an ambulance route.",
  routing: "Next: responder arrival and on-scene assessment.",
  on_scene: "Next: transport and hospital admission.",
  admitted: "Patient handed over to the receiving hospital.",
};

/** Deterministic text used when the LLM is unreachable, so the flow still demos. */
export function fallbackSummary(item: Case): string {
  const { identity, responder, hospital } = item.seed;
  const parts = [`${item.priority} ${item.title.toLowerCase()} at ${item.location}.`, `Patient ${identity.age}${identity.sex}${identity.conditions.length ? `, history of ${identity.conditions.join(", ")}` : ""}.`];
  if (item.route) parts.push(`${item.route.unitId} routed, ETA ${item.route.etaMinutes.toFixed(1)} min.`);
  if (reached(item, "on_scene")) {
    const v = responder.vitals;
    parts.push(`On scene: ${responder.symptoms.join(", ")}. HR ${v.hr}, BP ${v.bpSys}/${v.bpDia}, SpO2 ${v.spo2}%, GCS ${v.gcs}.`);
  }
  if (reached(item, "admitted")) parts.push(`Admitted to ${item.hospitalName}, ward ${hospital.ward}: ${hospital.admittedDiagnosis}.`);
  parts.push(NEXT_STEP[item.stage]);
  return parts.join(" ");
}

export function fallbackBrief(item: Case): string {
  const summary = item.triage?.summary;
  const unknown = summary?.missing.length ? ` Still unknown: ${summary.missing.join(", ")}.` : "";
  const status = summary ? ` Conscious: ${summary.conscious ?? "unknown"}, breathing: ${summary.breathing ?? "unknown"}, patients: ${summary.patients ?? "unknown"}.` : "";
  return `${item.priority} call: ${item.title} at ${item.location}.${status}${unknown}`;
}
