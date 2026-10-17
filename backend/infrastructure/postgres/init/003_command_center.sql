CREATE SCHEMA IF NOT EXISTS command_center;

CREATE TABLE IF NOT EXISTS command_center.schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS command_center.incidents (
    id VARCHAR(32) PRIMARY KEY,
    source_cluster_id VARCHAR(32) NOT NULL UNIQUE,
    source_version INTEGER NOT NULL CHECK (source_version > 0),
    command_version INTEGER NOT NULL DEFAULT 1 CHECK (command_version > 0),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    priority VARCHAR(2) NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
    original_priority VARCHAR(2) NOT NULL CHECK (original_priority IN ('P1', 'P2', 'P3', 'P4')),
    severity SMALLINT NOT NULL CHECK (severity BETWEEN 0 AND 100),
    confidence SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    status VARCHAR(24) NOT NULL DEFAULT 'new' CHECK (
        status IN ('new', 'acknowledged', 'assigned', 'en_route', 'on_scene', 'transporting', 'resolved', 'cancelled')
    ),
    location TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    first_reported_at TIMESTAMPTZ NOT NULL,
    last_reported_at TIMESTAMPTZ NOT NULL,
    signal_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    source_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_signal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    assigned_unit_id VARCHAR(40),
    receiving_hospital_id VARCHAR(40),
    owning_agency VARCHAR(100),
    priority_override_reason TEXT,
    sla_deadline TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    assigned_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_incidents_queue
    ON command_center.incidents(status, priority, sla_deadline);
CREATE INDEX IF NOT EXISTS idx_cc_incidents_updated
    ON command_center.incidents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_incidents_unit
    ON command_center.incidents(assigned_unit_id) WHERE assigned_unit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS command_center.assignments (
    id BIGSERIAL PRIMARY KEY,
    incident_id VARCHAR(32) NOT NULL REFERENCES command_center.incidents(id) ON DELETE CASCADE,
    unit_id VARCHAR(40) NOT NULL,
    receiving_hospital_id VARCHAR(40),
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'superseded', 'released')),
    assigned_by TEXT NOT NULL,
    rationale TEXT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_one_active_assignment
    ON command_center.assignments(incident_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS command_center.audit_events (
    id BIGSERIAL PRIMARY KEY,
    incident_id VARCHAR(32) REFERENCES command_center.incidents(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    from_state VARCHAR(24),
    to_state VARCHAR(24),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_audit_incident
    ON command_center.audit_events(incident_id, id DESC);

CREATE TABLE IF NOT EXISTS command_center.consumer_cursors (
    consumer_name TEXT PRIMARY KEY,
    last_event_id BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO command_center.consumer_cursors(consumer_name, last_event_id)
VALUES ('signal-fusion', 0)
ON CONFLICT (consumer_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS command_center.outbox_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_id VARCHAR(32) NOT NULL,
    aggregate_version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_outbox_version
    ON command_center.outbox_events(event_type, aggregate_id, aggregate_version);
CREATE INDEX IF NOT EXISTS idx_cc_outbox_cursor
    ON command_center.outbox_events(id);

INSERT INTO command_center.schema_migrations(version, description)
VALUES (1, 'Command Center incident lifecycle, assignments, audit, cursor, and outbox')
ON CONFLICT (version) DO NOTHING;
