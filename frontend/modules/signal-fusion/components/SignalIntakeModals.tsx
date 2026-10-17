"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AudioLines, Plus, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { ingestSignal, triageCall } from "../lib/api";
import type { SignalSource } from "../types";
import { sourceConfig } from "./PredictivePrimitives";

const sampleCall =
  "Hello 999, dekat Bukit Bintang, kereta langgar motor. Rider tak bergerak, hujan lebat sangat, banyak traffic.";

export default function SignalIntakeModals({
  mode,
  onClose,
  onComplete,
  onError,
}: {
  mode?: "signal" | "triage";
  onClose: () => void;
  onComplete: (clusterId: string, message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [audio, setAudio] = useState<File>();
  const [triageTranscript, setTriageTranscript] = useState(sampleCall);
  const [intake, setIntake] = useState({
    source: "CALL" as SignalSource,
    external_id: "",
    caller: "",
    transcript: "",
    location: "Bukit Bintang",
    latitude: 3.1468,
    longitude: 101.7113,
  });

  const submitSignal = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await ingestSignal({
        ...intake,
        external_id: intake.external_id || undefined,
        caller: intake.caller || "Anonymous / automated feed",
        metadata: { origin: "anwar-console" },
      });
      await onComplete(result.cluster.id, result.decision.reason);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Unable to ingest signal");
    } finally {
      setBusy(false);
    }
  };

  const submitTriage = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const audioPayload = audio
        ? await new Promise<{ audio_base64: string; audio_filename: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
              audio_base64: String(reader.result).split(",", 2)[1],
              audio_filename: audio.name,
            });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(audio);
          })
        : { transcript: triageTranscript };
      const result = await triageCall({ ...audioPayload, caller: "MERS 999 live intake" });
      if (!result.ingestion) {
        onError(`Call filtered as ${result.summary.call_class}; nothing entered fusion.`);
        return;
      }
      await onComplete(result.ingestion.cluster.id, result.ingestion.decision.reason);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Unable to triage call");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {mode ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
          {mode === "signal" ? (
            <motion.form initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onSubmit={submitSignal} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center gap-3 border-b border-slate-200 p-4">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700"><Plus size={17} /></div>
                <div><div className="text-sm font-bold text-slate-950">Ingest operational signal</div><div className="text-[10px] text-slate-500">Weather, traffic, CCTV, calls, or field evidence</div></div>
                <button type="button" onClick={onClose} className="ml-auto text-slate-500"><X size={17} /></button>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <label className="text-[10px] font-bold text-slate-600">Source<select value={intake.source} onChange={(event) => setIntake({ ...intake, source: event.target.value as SignalSource })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900">{Object.keys(sourceConfig).map((source) => <option key={source}>{source}</option>)}</select></label>
                <label className="text-[10px] font-bold text-slate-600">External ID<input value={intake.external_id} onChange={(event) => setIntake({ ...intake, external_id: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-xs" placeholder="Optional idempotency key" /></label>
                <label className="text-[10px] font-bold text-slate-600 sm:col-span-2">Feed / caller<input value={intake.caller} onChange={(event) => setIntake({ ...intake, caller: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-xs" placeholder="Source identity" /></label>
                <label className="text-[10px] font-bold text-slate-600 sm:col-span-2">Location<input required value={intake.location} onChange={(event) => setIntake({ ...intake, location: event.target.value })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-xs" /></label>
                <label className="text-[10px] font-bold text-slate-600">Latitude<input required type="number" step="0.000001" value={intake.latitude} onChange={(event) => setIntake({ ...intake, latitude: Number(event.target.value) })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-xs" /></label>
                <label className="text-[10px] font-bold text-slate-600">Longitude<input required type="number" step="0.000001" value={intake.longitude} onChange={(event) => setIntake({ ...intake, longitude: Number(event.target.value) })} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-xs" /></label>
                <label className="text-[10px] font-bold text-slate-600 sm:col-span-2">Summary / transcript<textarea required minLength={5} value={intake.transcript} onChange={(event) => setIntake({ ...intake, transcript: event.target.value })} className="mt-1 h-28 w-full resize-none rounded-lg border border-slate-300 p-3 text-xs" /></label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
                <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">Cancel</button>
                <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Send size={13} />Fuse signal</button>
              </div>
            </motion.form>
          ) : (
            <motion.form initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onSubmit={submitTriage} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center gap-3 border-b border-slate-200 p-4">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700"><AudioLines size={17} /></div>
                <div><div className="text-sm font-bold text-slate-950">AI-assisted 999 call triage</div><div className="text-[10px] text-slate-500">Transcript and audio remain reviewable evidence</div></div>
                <button type="button" onClick={onClose} className="ml-auto text-slate-500"><X size={17} /></button>
              </div>
              <div className="space-y-3 p-4">
                <label className="block text-[10px] font-bold text-slate-600">Live transcript<textarea value={triageTranscript} onChange={(event) => setTriageTranscript(event.target.value)} className="mt-1 h-36 w-full resize-none rounded-lg border border-slate-300 p-3 text-xs leading-5" /></label>
                <label className="block text-[10px] font-bold text-slate-600">Original call audio<input type="file" accept="audio/*" onChange={(event) => setAudio(event.target.files?.[0])} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-xs" /></label>
                <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-[10px] text-blue-800"><ShieldCheck size={13} />AI extracts location, patients, condition, and priority. The operator remains responsible for action.</div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
                <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">Cancel</button>
                <button disabled={busy || (!triageTranscript.trim() && !audio)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Sparkles size={13} />Triage and fuse</button>
              </div>
            </motion.form>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
