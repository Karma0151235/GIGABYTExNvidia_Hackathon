CREATE SCHEMA IF NOT EXISTS signal_fusion;

CREATE TABLE IF NOT EXISTS signal_fusion.schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_fusion.clusters (
    id VARCHAR(32) PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    location TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    signal_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    confidence SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    severity SMALLINT NOT NULL CHECK (severity BETWEEN 0 AND 100),
    priority VARCHAR(2) NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
    status VARCHAR(16) NOT NULL CHECK (status IN ('emerging', 'verified', 'promoted', 'dismissed')),
    first_seen TIMESTAMPTZ NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    source_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
    signal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    incident_id VARCHAR(32),
    version INTEGER NOT NULL DEFAULT 1,
    centroid JSONB NOT NULL,
    embedding_provider TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_fusion.signals (
    id VARCHAR(32) PRIMARY KEY,
    external_id VARCHAR(160) UNIQUE,
    source VARCHAR(16) NOT NULL CHECK (source IN ('WEATHER', 'TRAFFIC', 'CALL', 'FIELD', 'SMS', 'APP', 'RADIO', 'CCTV')),
    caller VARCHAR(120) NOT NULL,
    transcript TEXT NOT NULL,
    location TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    occurred_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL,
    severity SMALLINT NOT NULL CHECK (severity BETWEEN 0 AND 100),
    status VARCHAR(16) NOT NULL CHECK (status IN ('new', 'correlated', 'clustered', 'duplicate', 'dismissed')),
    cluster_id VARCHAR(32) REFERENCES signal_fusion.clusters(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding JSONB NOT NULL,
    embedding_provider TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sf_signals_cluster ON signal_fusion.signals(cluster_id);
CREATE INDEX IF NOT EXISTS idx_sf_signals_received ON signal_fusion.signals(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sf_clusters_status_risk ON signal_fusion.clusters(status, severity DESC, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_sf_clusters_last_seen ON signal_fusion.clusters(last_seen DESC);

CREATE TABLE IF NOT EXISTS signal_fusion.incident_handoffs (
    id VARCHAR(32) PRIMARY KEY,
    source_cluster_id VARCHAR(32) NOT NULL UNIQUE REFERENCES signal_fusion.clusters(id),
    version INTEGER NOT NULL,
    state VARCHAR(40) NOT NULL DEFAULT 'ready_for_command_center',
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    priority VARCHAR(2) NOT NULL,
    severity SMALLINT NOT NULL,
    confidence SMALLINT NOT NULL,
    location TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    first_reported_at TIMESTAMPTZ NOT NULL,
    last_reported_at TIMESTAMPTZ NOT NULL,
    signal_count INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL,
    source_mix JSONB NOT NULL,
    source_signal_ids JSONB NOT NULL,
    key_facts JSONB NOT NULL,
    risk_flags JSONB NOT NULL,
    recommended_actions JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS signal_fusion.audit_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(32) NOT NULL,
    actor TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sf_audit_entity ON signal_fusion.audit_events(entity_type, entity_id, id DESC);

CREATE TABLE IF NOT EXISTS signal_fusion.outbox_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_id VARCHAR(32) NOT NULL,
    aggregate_version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sf_outbox_cursor ON signal_fusion.outbox_events(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sf_incident_version_event
    ON signal_fusion.outbox_events(event_type, aggregate_id, aggregate_version);

CREATE TABLE IF NOT EXISTS signal_fusion.risks (
    id VARCHAR(32) PRIMARY KEY,
    zone VARCHAR(120) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    level VARCHAR(8) NOT NULL CHECK (level IN ('low', 'medium', 'high', 'critical')),
    confidence SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_action VARCHAR(20) NOT NULL CHECK (recommended_action IN ('monitor', 'notify', 'stage_unit', 'alert_hospital')),
    generated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(120),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sf_risks_active ON signal_fusion.risks(zone, expires_at DESC);

CREATE TABLE IF NOT EXISTS signal_fusion.risk_signals (
    id VARCHAR(32) PRIMARY KEY,
    risk_id VARCHAR(32) NOT NULL REFERENCES signal_fusion.risks(id) ON DELETE CASCADE,
    external_id VARCHAR(160) UNIQUE,
    source VARCHAR(16) NOT NULL CHECK (source IN ('rainfall', 'congestion', 'weather', 'traffic', 'cctv', 'event', 'field')),
    zone VARCHAR(120) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    severity SMALLINT NOT NULL CHECK (severity BETWEEN 0 AND 100),
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    validity_minutes SMALLINT NOT NULL CHECK (validity_minutes BETWEEN 30 AND 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sf_risk_signals_zone_observed
    ON signal_fusion.risk_signals(zone, observed_at DESC);

INSERT INTO signal_fusion.schema_migrations(version, description)
VALUES (1, 'Initial durable Signal Fusion schema and transactional outbox')
ON CONFLICT (version) DO NOTHING;

INSERT INTO signal_fusion.schema_migrations(version, description)
VALUES (2, 'Add deterministic early-warning risk signals and assessments')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE signal_fusion.signals DROP CONSTRAINT IF EXISTS signals_source_check;
ALTER TABLE signal_fusion.signals ADD CONSTRAINT signals_source_check
    CHECK (source IN ('WEATHER', 'TRAFFIC', 'CALL', 'FIELD', 'SMS', 'APP', 'RADIO', 'CCTV'));
ALTER TABLE signal_fusion.signals DROP CONSTRAINT IF EXISTS signals_status_check;
ALTER TABLE signal_fusion.signals ADD CONSTRAINT signals_status_check
    CHECK (status IN ('new', 'correlated', 'clustered', 'duplicate', 'dismissed'));
ALTER TABLE signal_fusion.risk_signals DROP CONSTRAINT IF EXISTS risk_signals_source_check;
ALTER TABLE signal_fusion.risk_signals ADD CONSTRAINT risk_signals_source_check
    CHECK (source IN ('rainfall', 'congestion', 'weather', 'traffic', 'cctv', 'event', 'field'));

INSERT INTO signal_fusion.schema_migrations(version, description)
VALUES (3, 'Add predictive weather and traffic evidence sources')
ON CONFLICT (version) DO NOTHING;
