import { photoTriage, reached, type Case, type Stage } from "@/modules/workflow/lib/caseReducer";
import type { Doc } from "@/modules/workflow/lib/retrieval";

// Knowledge graph of one case: a spine of pipeline stages plus entity nodes hanging off each stage.
export type Lane = "intake" | "routing" | "on_scene" | "admitted";
export type KNode = { id: string; column: number; slot: number; title: string; label: string; detail: string; lane: Lane; pending: boolean };
export type KEdge = { from: string; to: string; label: string; pending: boolean; spine: boolean };

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const yesNo = (value: boolean | null | undefined) => (value == null ? "unknown" : value ? "yes" : "no");

export function buildGraph(item: Case): { nodes: KNode[]; edges: KEdge[] } {
  const { identity, responder, hospital } = item.seed;
  const summary = item.triage?.summary;
  const noCall = !summary;
  const routed = reached(item, "routing");
  const onScene = reached(item, "on_scene");
  const admitted = reached(item, "admitted");
  const routeEvent = item.timeline.find((event) => event.stage === "routing");
  const v = responder.vitals;
  const photo = item.vlmDraft ? photoTriage(item.vlmDraft) : undefined;
  // Fusion metadata carries the triage provider ("llm" or "heuristic") for emergency calls.
  const provider = item.triage?.ingestion?.signal.metadata?.triage_provider;

  const nodes: KNode[] = [
    { id: "audio", column: 0, slot: 0, lane: "intake", pending: noCall, title: "999 call audio", label: item.sampleName?.replace(/\.mp3$/, "") ?? "No recording", detail: summary ? `Call ${summary.call_id} received ${clock(summary.received_at)}. Recording: ${item.sampleName ?? "uploaded audio"}.` : "Opened from the dispatch board; no call recording." },
    { id: "patient", column: 0, slot: -1, lane: "intake", pending: false, title: "Patient", label: `${identity.name.split(" ")[0]} / ${identity.age}${identity.sex}`, detail: `${identity.name}, ${identity.age} ${identity.sex === "M" ? "male" : "female"}. Conditions: ${identity.conditions.join(", ") || "none known"}. Allergies: ${identity.allergies.join(", ") || "none known"}. Next of kin: ${identity.nextOfKin ?? "unknown"}.` },
    { id: "transcript", column: 1, slot: 0, lane: "intake", pending: noCall, title: "Transcript", label: summary ? `${summary.transcript.split(/\s+/).length} words` : "None", detail: summary?.transcript || "No transcript." },
    { id: "triage", column: 2, slot: 0, lane: "intake", pending: noCall && !item.priority, title: `Priority ${item.priority}`, label: summary?.call_class ?? "dispatch incident", detail: `${item.title}. Decision path: ${item.triage?.path.map((step) => `${step.question} ${step.answer}`).join("; ") || "n/a"}. Conscious: ${yesNo(summary?.conscious)}, breathing: ${yesNo(summary?.breathing)}, patients: ${summary?.patients ?? "unknown"}. Triaged by ${provider === "heuristic" ? "keyword fallback (LLM unavailable)" : provider === "llm" ? "Nemotron Lightning" : "dispatch board"}.` },
    { id: "location", column: 2, slot: -1, lane: "intake", pending: false, title: "Location", label: item.location.slice(0, 24), detail: `${item.location}${summary?.location?.lat != null ? ` (${summary.location.lat.toFixed(4)}, ${summary.location.lng?.toFixed(4)})` : ""}.` },
    { id: "ambulance", column: 3, slot: 0, lane: "routing", pending: !routed, title: "Ambulance", label: item.route?.unitId ?? (routed ? "No road route" : "Not routed"), detail: item.route ? `${item.route.unitId} routed, ETA ${item.route.etaMinutes.toFixed(1)} min over ${item.route.distanceKm.toFixed(1)} km.${item.dispatchId ? ` Dispatch ${item.dispatchId} accepted.` : ""}` : routeEvent ? `${routeEvent.label}. ${routeEvent.detail ?? ""}` : "No ambulance routed yet." },
    { id: "responder", column: 4, slot: 0, lane: "on_scene", pending: !onScene, title: "First responder", label: onScene ? "On scene" : "Awaiting", detail: responder.notes },
    { id: "vitals", column: 4, slot: -1, lane: "on_scene", pending: !onScene, title: "Vitals", label: `HR ${v.hr} / SpO2 ${v.spo2}%`, detail: `HR ${v.hr} bpm, BP ${v.bpSys}/${v.bpDia}, SpO2 ${v.spo2}%, RR ${v.rr}/min, GCS ${v.gcs}${v.tempC != null ? `, temp ${v.tempC} C` : ""}.` },
    { id: "symptoms", column: 4, slot: 1, lane: "on_scene", pending: !onScene, title: "Symptoms", label: responder.symptoms[0], detail: responder.symptoms.join(", ") + "." },
    { id: "treatment", column: 4, slot: -2, lane: "on_scene", pending: !onScene, title: "Pre-hospital care", label: `${responder.treatment.length} steps`, detail: responder.treatment.map((step) => `${step.at} ${step.action}`).join("; ") + "." },
    { id: "hospital", column: 5, slot: 0, lane: "admitted", pending: !admitted, title: "Hospital", label: (item.hospitalName ?? hospital.facilityName).slice(0, 24), detail: `${admitted ? "Admitted to" : "Destination"} ${item.hospitalName ?? hospital.facilityName}. Status: ${hospital.status}.` },
    { id: "ward", column: 5, slot: -1, lane: "admitted", pending: !admitted, title: "Ward", label: `${hospital.ward}${hospital.bed ? ` / ${hospital.bed}` : ""}`, detail: `Ward ${hospital.ward}${hospital.bed ? `, bed ${hospital.bed}` : ""}.` },
    { id: "diagnosis", column: 5, slot: 1, lane: "admitted", pending: !admitted, title: "Diagnosis", label: hospital.admittedDiagnosis.slice(0, 24), detail: `Admitting diagnosis: ${hospital.admittedDiagnosis}. Treatment plan: ${hospital.treatment.join("; ")}.` },
  ];
  if (summary?.missing.length) nodes.push({ id: "missing", column: 2, slot: 1, lane: "intake", pending: false, title: "Still unknown", label: summary.missing.join(", "), detail: `Caller did not confirm: ${summary.missing.join(", ")}.` });
  if (photo && item.vlmDraft) nodes.push({ id: "photo", column: 4, slot: 2, lane: "on_scene", pending: false, title: "Photo triage", label: photo.level, detail: item.vlmDraft.image_notes.map((note) => note.note).join("\n") });

  const pendingOf = (id: string) => nodes.find((node) => node.id === id)?.pending ?? true;
  const spine = (from: string, to: string, label: string): KEdge => ({ from, to, label, spine: true, pending: pendingOf(to) });
  const link = (from: string, to: string, label: string): KEdge => ({ from, to, label, spine: false, pending: pendingOf(to) });
  const edges = [
    spine("audio", "transcript", "Omni STT"),
    spine("transcript", "triage", provider === "heuristic" ? "keyword fallback" : "Lightning triage"),
    spine("triage", "ambulance", item.route ? "dispatched" : "routed"),
    spine("ambulance", "responder", "arrived"),
    spine("responder", "hospital", "handed over"),
    link("audio", "patient", "caller for"),
    link("triage", "location", "located at"),
    link("responder", "vitals", "measured"),
    link("responder", "symptoms", "presented"),
    link("responder", "treatment", "treated"),
    link("hospital", "ward", "admitted to"),
    link("hospital", "diagnosis", "diagnosed"),
  ];
  if (nodes.some((node) => node.id === "missing")) edges.push(link("triage", "missing", "unconfirmed"));
  if (nodes.some((node) => node.id === "photo")) edges.push(link("responder", "photo", "photographed"));
  return { nodes, edges };
}

const LANE_NODE: Record<Stage, string> = { intake: "triage", routing: "ambulance", on_scene: "responder", admitted: "hospital" };

/** Every known fact across all cases, one short doc per graph node and timeline event, for retrieval. */
export function buildDocs(cases: Case[]): Doc[] {
  const docs: Omit<Doc, "id">[] = [];
  for (const item of cases) {
    const tag = `[${item.priority} ${item.title.slice(0, 50)} / ${item.callId}]`;
    for (const node of buildGraph(item).nodes) if (!node.pending) docs.push({ callId: item.callId, nodeId: node.id, text: `${tag} ${node.title}: ${node.detail}` });
    for (const event of item.timeline) docs.push({ callId: item.callId, nodeId: LANE_NODE[event.stage], text: `${tag} Timeline ${clock(event.at)}: ${event.label}${event.detail ? ` (${event.detail})` : ""}` });
    if (item.agentSummary) docs.push({ callId: item.callId, nodeId: LANE_NODE[item.stage], text: `${tag} Agent case summary: ${item.agentSummary.text}` });
  }
  return docs.map((doc, index) => ({ ...doc, id: `D${index + 1}` }));
}
