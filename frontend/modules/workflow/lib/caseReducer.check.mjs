// Run: node modules/workflow/lib/caseReducer.check.mjs  (Node >= 23 strips the .ts types)
import assert from "node:assert/strict";
import { initialState, reducer, fallbackSummary, photoTriage } from "./caseReducer.ts";

const seed = {
  identity: { name: "Test", ic: "000000-00-0000", age: 40, sex: "M", phone: "-", allergies: [], conditions: [] },
  responder: { symptoms: ["pain"], treatment: [{ at: "+1m", action: "O2" }, { at: "+2m", action: "IV" }], vitals: { hr: 100, bpSys: 120, bpDia: 80, spo2: 95, rr: 18, gcs: 15 }, notes: "" },
  hospital: { facilityName: "HKL", ward: "CCU", admittedDiagnosis: "x", treatment: [], attending: "y", status: "z" },
};
const triage = (call_class, call_id = "C1") => ({ summary: { call_id, call_class, priority: "P1", received_at: "2026-10-17T00:00:00Z", complaint: "Chest pain", location: { text: "KLCC" }, missing: [], transcript: "" }, path: [] });
const at = "2026-10-17T00:01:00Z";
const route = { id: "R1", unitId: "U1", etaMinutes: 5, distanceKm: 2 };

let s = reducer(initialState, { type: "callTriaged", name: "spam.mp3", result: triage("spam", "S1"), seed, at });
assert.equal(s.order.length, 0, "non-emergency calls never become cases");

s = reducer(s, { type: "callTriaged", name: "a.mp3", result: triage("emergency"), seed, at });
assert.equal(s.cases.C1.stage, "intake");
assert.equal(s.selectedId, "C1", "first case auto-selected");
assert.equal(reducer(s, { type: "callTriaged", name: "a.mp3", result: triage("emergency"), seed, at }), s, "re-triage is a no-op");

assert.equal(reducer(s, { type: "markOnScene", callId: "C1", at }), s, "cannot reach scene before routing");
s = reducer(s, { type: "routeSelected", callId: "C1", route, at });
assert.equal(s.cases.C1.stage, "routing");
assert.equal(reducer(s, { type: "routeSelected", callId: "C1", route, at }), s, "same route twice adds no event");

const before = s.cases.C1.timeline.length;
s = reducer(s, { type: "markOnScene", callId: "C1", at });
assert.equal(s.cases.C1.stage, "on_scene");
assert.equal(s.cases.C1.timeline.length, before + 3, "on-scene event plus one per treatment step");

s = reducer(s, { type: "routeSelected", callId: "C1", route: { ...route, id: "R2" }, at });
assert.equal(s.cases.C1.stage, "on_scene", "stage never goes backwards");

s = reducer(s, { type: "admit", callId: "C1", hospitalName: "HKL", at });
assert.equal(s.cases.C1.stage, "admitted");

const stale = reducer(s, { type: "summaryReady", callId: "C1", eventCount: 1, summary: { text: "old", at, offline: false } });
assert.equal(stale, s, "stale summaries dropped");
s = reducer(s, { type: "summaryReady", callId: "C1", eventCount: s.cases.C1.timeline.length, summary: { text: "new", at, offline: false } });
assert.equal(s.cases.C1.agentSummary.text, "new");
assert.match(fallbackSummary(s.cases.C1), /Admitted to HKL/);
const note = "ER TRIAGE NOTE (TEST OUTPUT ONLY)\n=====\nTRIAGE: URGENT\nDeformed left forearm, no active bleeding\n-----\nNot a medical or legal assessment.";
assert.deepEqual(photoTriage({ image_notes: [{ image_id: "IMG-1", kind: "injury", note }] }), { level: "URGENT", reason: "Deformed left forearm, no active bleeding" });
assert.equal(photoTriage({ image_notes: [] }).level, "CANNOT DETERMINE");
console.log("caseReducer ok");
