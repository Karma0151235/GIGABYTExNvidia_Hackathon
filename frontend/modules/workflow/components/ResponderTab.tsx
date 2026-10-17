"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Stethoscope } from "lucide-react";
import { photoTriage, reached, type Action, type Case } from "@/modules/workflow/lib/caseReducer";
import { draftClinicalReport } from "@/modules/workflow/lib/clinicalReport";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read photo"));
    reader.readAsDataURL(file);
  });
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-2 text-[10px] font-black uppercase tracking-[.14em] text-slate-500">{title}</div>{children}</div>;
}

export default function ResponderTab({ item, dispatch }: { item?: Case; dispatch: (action: Action) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!item) return <div className="grid h-full place-items-center text-sm text-slate-500">Select a case to see the first responder view.</div>;

  const onScene = reached(item, "on_scene");
  const { responder } = item.seed;
  const unit = item.route?.unitId ?? item.preview?.selected?.unit_id ?? "unit pending";
  const photo = item.photos.at(-1);

  const attach = async (file?: File) => {
    setError(undefined);
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) return setError("Photo exceeds the 5 MB limit.");
    const summary = item.triage?.summary;
    setBusy(true);
    try {
      const dataUrl = await readDataUrl(file);
      dispatch({ type: "photoAdded", callId: item.callId, dataUrl });
      const draft = await draftClinicalReport({
        call_id: item.callId, incident_id: item.callId, dispatch_id: item.dispatchId ?? item.route?.id ?? item.callId,
        incident_summary: item.callBrief?.text ?? item.title,
        geolocation: { locality: item.location, latitude: summary?.location?.lat, longitude: summary?.location?.lng },
        call_transcript: summary?.transcript?.slice(0, 4000) || null,
        responder_notes: responder.notes,
        receiving_facility_name: item.seed.hospital.facilityName,
        images: [{ image_id: `IMG-${item.photos.length + 1}`, kind: "injury", media_type: file.type, data_base64: dataUrl.split(",", 2)[1] }],
      });
      dispatch({ type: "vlmDraftReady", callId: item.callId, draft, at: new Date().toISOString() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Photo analysis failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3.5">
      <div data-testid="responder-media" className="relative grid min-h-[420px] flex-[0_0_62%] place-items-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-400">
        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL, nothing to optimise */}
        {photo ? <img src={photo} alt="Responder photo" className="h-full w-full object-contain" /> : (
          <div className="text-center"><Camera size={44} className="mx-auto mb-3 text-slate-600" /><div className="text-sm font-semibold text-slate-300">Responder body-cam / photo feed</div><div className="mt-1 text-xs">{unit}</div></div>
        )}
        <div className="absolute left-4 top-4 flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${onScene ? "bg-red-600 text-white" : "bg-slate-800 text-slate-400"}`}>{onScene ? "Live / on scene" : "Waiting"}</span>
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-slate-300">{unit}</span>
        </div>
        <div className="absolute bottom-4 right-4 flex gap-2">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid="photo-input" onChange={(event) => void attach(event.target.files?.[0])} />
          <button type="button" disabled={!onScene || busy} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-white/20 disabled:opacity-40"><ImagePlus size={14} />{busy ? "Analysing..." : "Attach responder photo"}</button>
        </div>
      </div>

      {error ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800">{error}</p> : null}

      {onScene ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title="Symptoms"><div className="flex flex-wrap gap-1.5">{responder.symptoms.map((symptom) => <span key={symptom} className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">{symptom}</span>)}</div></Card>
          <Card title="Treatment given"><ol className="space-y-1.5 text-xs">{responder.treatment.map((step) => <li key={step.action} className="flex gap-2"><span className="w-8 shrink-0 font-mono text-slate-400">{step.at}</span><span className="font-semibold text-slate-800">{step.action}</span></li>)}</ol></Card>
          <Card title="Responder notes"><p className="text-xs leading-5 text-slate-700">{responder.notes}</p></Card>
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <Stethoscope size={22} className="text-slate-400" />
          <div className="flex-1 text-sm text-slate-600">
            {reached(item, "routing") ? `Waiting for responder: ${unit}${item.route ? ` ETA ${item.route.etaMinutes.toFixed(1)} min` : ""}.` : "No ambulance routed yet. Pick a route on the Route tab first."}
          </div>
          <button type="button" disabled={!reached(item, "routing")} onClick={() => dispatch({ type: "markOnScene", callId: item.callId, at: new Date().toISOString() })} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">Mark on scene</button>
        </div>
      )}

      {item.vlmDraft ? (
        <Card title={`Photo triage: ${photoTriage(item.vlmDraft).level} / draft, clinician review required`}>
          {item.vlmDraft.image_notes.map((entry) => <pre key={entry.image_id} data-testid="photo-note" className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-5 text-slate-800">{entry.note}</pre>)}
        </Card>
      ) : null}
    </div>
  );
}
