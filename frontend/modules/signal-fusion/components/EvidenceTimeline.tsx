"use client";

import { Check, Database, Scissors } from "lucide-react";
import { useState } from "react";
import { splitCluster } from "../lib/api";
import type { Signal, SignalCluster } from "../types";
import { myt, SourceBadge, sourceConfig } from "./PredictivePrimitives";

export default function EvidenceTimeline({
  cluster,
  evidence,
  onRefresh,
  onSelectCluster,
  onError,
}: {
  cluster: SignalCluster;
  evidence: Signal[];
  onRefresh: () => Promise<void>;
  onSelectCluster: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [splitMode, setSplitMode] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submitSplit = async () => {
    if (!selection.length || selection.length >= evidence.length) return;
    setBusy(true);
    try {
      const result = await splitCluster(
        cluster.id,
        selection,
        "Operator identified evidence requiring separate review",
      );
      onSelectCluster(result.created.id);
      setSelection([]);
      setSplitMode(false);
      await onRefresh();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Unable to split evidence");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <Database size={14} className="text-sky-700" />
        {evidence.length} original records retained. Weather and traffic are correlated evidence, never duplicates.
      </div>
      <div>
        {evidence.map((signal, index) => {
          const Icon = sourceConfig[signal.source].icon;
          const selected = selection.includes(signal.id);
          return (
            <div key={signal.id} className="relative flex gap-3 pb-5">
              {index < evidence.length - 1 ? <div className="absolute bottom-0 left-[15px] top-8 w-px bg-slate-200" /> : null}
              <button
                type="button"
                disabled={!splitMode}
                onClick={() => setSelection((current) =>
                  current.includes(signal.id)
                    ? current.filter((id) => id !== signal.id)
                    : [...current, signal.id]
                )}
                className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 bg-white ${selected ? "border-blue-600 text-blue-700" : "border-slate-300 text-slate-600"}`}
                aria-label={`Select ${signal.id} for split`}
              >
                {selected ? <Check size={13} /> : <Icon size={13} />}
              </button>
              <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={signal.source} />
                  <span className="font-mono text-[9px] text-slate-500">{signal.id}</span>
                  <span className="ml-auto font-mono text-[9px] font-bold text-slate-700">{myt(signal.observed_at ?? signal.received_at)} MYT</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-700">{signal.transcript}</p>
                {signal.metadata?.extracted_facts ? (
                  <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[10px] leading-4 text-slate-600">
                    <strong>Extracted:</strong> {String(signal.metadata.extracted_facts)}
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-3 gap-2 text-[9px]">
                  <div><span className="text-slate-500">Severity</span><div className="font-bold text-slate-900">{signal.severity}/100</div></div>
                  <div><span className="text-slate-500">Source confidence</span><div className="font-bold text-slate-900">{Math.round(signal.source_confidence * 100)}%</div></div>
                  <div><span className="text-slate-500">Role</span><div className="font-bold capitalize text-slate-900">{signal.evidence_role.replace("_", " ")}</div></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={() => { setSplitMode((value) => !value); setSelection([]); }}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-[10px] font-bold text-slate-700"
        >
          <Scissors size={12} />{splitMode ? "Cancel split" : "Split evidence"}
        </button>
        {splitMode ? (
          <button
            type="button"
            disabled={!selection.length || selection.length >= evidence.length || busy}
            onClick={() => void submitSplit()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-40"
          >
            Create separate cluster ({selection.length})
          </button>
        ) : null}
      </div>
    </div>
  );
}
