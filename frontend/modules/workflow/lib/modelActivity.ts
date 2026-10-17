import { useSyncExternalStore } from "react";

// In-browser log of DGX Spark model calls so the UI can show what is in flight and what failed.
export type ModelKey = "lightning" | "nano" | "omni";
export type CallStatus = "calling" | "ok" | "error" | "skipped";
export type ModelCall = { id: number; model: ModelKey; label: string; status: CallStatus; startedAt: number; ms?: number; detail?: string };

export const MODEL_NAME: Record<ModelKey, string> = { lightning: "Lightning", nano: "Nano", omni: "Omni" };

let calls: ModelCall[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function startCall(model: ModelKey, label: string): number {
  const id = nextId++;
  calls = [{ id, model, label, status: "calling" as const, startedAt: Date.now() }, ...calls].slice(0, 40);
  emit();
  return id;
}

export function endCall(id: number, status: Exclude<CallStatus, "calling">, detail?: string) {
  calls = calls.map((call) => (call.id === id ? { ...call, status, detail, ms: Date.now() - call.startedAt } : call));
  emit();
}

export function useModelCalls(): ModelCall[] {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => calls,
    () => calls,
  );
}
