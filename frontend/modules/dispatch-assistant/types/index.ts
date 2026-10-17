export type ArtifactFormat =
  | "text" | "number" | "minutes" | "distance" | "percent"
  | "score" | "priority" | "boolean";

export type ArtifactColumn = {
  key: string;
  label: string;
  format: ArtifactFormat;
};

export type ArtifactMetric = {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "cyan" | "green" | "amber" | "red" | "slate";
};

export type VisualArtifact = {
  id: string;
  type: "table" | "metrics" | "recommendation";
  title: string;
  subtitle: string;
  columns: ArtifactColumn[];
  rows: Array<Record<string, unknown>>;
  metrics: ArtifactMetric[];
};

export type QueryExecution = {
  id: string;
  label: string;
  mode: "static_read_model";
  focus_incident_id: string | null;
  row_count: number;
  executed_at: string;
  data_sources: string[];
};

export type AssistantResponse = {
  session_id: string;
  answer: string;
  intent: string;
  sources: string[];
  suggested_actions: string[];
  generated_at: string;
  limitations: string[];
  recommended_unit_id: string | null;
  recommended_facility_id: string | null;
  rationale: string;
  confidence: number;
  provider: "openrouter" | "deterministic";
  model: string;
  query: QueryExecution;
  artifacts: VisualArtifact[];
};

export type SessionEntry = {
  id: number;
  incident_id: string | null;
  question: string;
  answer: string;
  intent: string;
  sources: string[];
  suggested_actions: string[];
  limitations: string[];
  created_at: string;
};

export type SopSnippet = { topic: string; owner: string; version: string; content: string };
