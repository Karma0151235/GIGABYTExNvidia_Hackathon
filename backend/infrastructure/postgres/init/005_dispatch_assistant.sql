CREATE SCHEMA IF NOT EXISTS dispatch_assistant;

CREATE TABLE IF NOT EXISTS dispatch_assistant.schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_assistant.queries (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    incident_id VARCHAR(64),
    question TEXT NOT NULL,
    intent VARCHAR(64) NOT NULL,
    answer TEXT NOT NULL,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    suggested_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_da_queries_session ON dispatch_assistant.queries(session_id, id DESC);

INSERT INTO dispatch_assistant.schema_migrations(version, description)
VALUES (1, 'Deterministic assistant query audit and session history')
ON CONFLICT (version) DO NOTHING;
