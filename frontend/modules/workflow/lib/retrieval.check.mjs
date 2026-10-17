// Run: node modules/workflow/lib/retrieval.check.mjs
import assert from "node:assert/strict";
import { citedIds, retrieve, tokenize } from "./retrieval.ts";

const docs = [
  { id: "S1", callId: "A", nodeId: "triage", text: "Priority P1. Chest pain at KLCC concourse." },
  { id: "S2", callId: "A", nodeId: "vitals", text: "Vitals: HR 112, SpO2 91%, BP 92/58." },
  { id: "S3", callId: "B", nodeId: "hospital", text: "Admitted to Hospital Kuala Lumpur, Orthopaedic ward, hip fracture." },
  { id: "S4", callId: "A", nodeId: "hospital", text: "Admitted to Institut Jantung Negara, CCU bed 4." },
];
assert.deepEqual(tokenize("What was the SpO2?"), ["spo2"]);
assert.equal(retrieve(docs, "what was the spo2 reading")[0].id, "S2");
assert.equal(retrieve(docs, "which ward for the hip fracture")[0].id, "S3");
assert.equal(retrieve(docs, "admitted")[0].id, "S4");
assert.equal(retrieve(docs, "admitted", "B")[0].id, "S3", "focused case boosted over a closer match");
assert.deepEqual(retrieve(docs, "what happened?", "B").map((doc) => doc.id), ["S3"], "no match falls back to focused case");
assert.deepEqual(citedIds("HR was 112 [S2] and admitted to CCU [S4, S2]."), ["S2", "S4"]);
console.log("retrieval ok");
