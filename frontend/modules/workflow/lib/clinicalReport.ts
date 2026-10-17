import { signalFusionApiUrl } from "@/modules/signal-fusion/lib/api";

// Mirrors backend/modules/field-clinical-report/models/schemas.py (fields the UI reads).
export type DraftReport = {
  report_id: string;
  // Fixed-layout VLM notes; see SYSTEM_PROMPT in report_service.py.
  image_notes: { image_id: string; kind: string; note: string }[];
  video_note: string | null;
  video_sha256: string | null;
  video_method: "native" | "frames" | null;
  model: string;
  limitations: string[];
};

export type DraftRequest = {
  call_id: string;
  incident_id: string;
  dispatch_id: string;
  incident_summary: string;
  geolocation: { locality?: string | null; address?: string | null; latitude?: number | null; longitude?: number | null };
  call_transcript?: string | null;
  responder_notes?: string | null;
  receiving_facility_name?: string | null;
  hospital_eta_minutes?: number | null;
  images?: { image_id: string; kind: "injury"; media_type: string; data_base64: string }[];
  video?: { video_id: string; media_type: "video/mp4"; data_base64: string };
  video_frames?: { image_id: string; kind: "other"; media_type: "image/jpeg"; data_base64: string }[];
};

export async function draftClinicalReport(payload: DraftRequest): Promise<DraftReport> {
  const response = await fetch(signalFusionApiUrl("/api/field-clinical-report/reports/draft"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : `Report service returned ${response.status}`;
    throw new Error(response.status === 503 ? `VLM offline: ${detail}` : detail);
  }
  return response.json() as Promise<DraftReport>;
}
