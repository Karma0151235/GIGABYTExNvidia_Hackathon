CREATE SCHEMA IF NOT EXISTS live_dispatch;

CREATE TABLE IF NOT EXISTS live_dispatch.schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_dispatch.facilities (
    id VARCHAR(40) PRIMARY KEY,
    name TEXT NOT NULL,
    facility_type VARCHAR(24) NOT NULL CHECK (facility_type IN ('hospital', 'ambulance_base')),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    accepting_patients BOOLEAN NOT NULL DEFAULT TRUE,
    ed_load_percent SMALLINT NOT NULL DEFAULT 50 CHECK (ed_load_percent BETWEEN 0 AND 100),
    ambulance_bays SMALLINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_dispatch.units (
    id VARCHAR(40) PRIMARY KEY,
    callsign VARCHAR(60) NOT NULL,
    agency VARCHAR(100) NOT NULL,
    base_facility_id VARCHAR(40) REFERENCES live_dispatch.facilities(id),
    status VARCHAR(24) NOT NULL CHECK (status IN ('available', 'reserved', 'dispatched', 'en_route', 'on_scene', 'transporting', 'at_hospital', 'offline')),
    equipment_type VARCHAR(20) NOT NULL CHECK (equipment_type IN ('BLS', 'ALS', 'ICU', 'NEONATAL', 'RESCUE')),
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    crew JSONB NOT NULL DEFAULT '[]'::jsonb,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    heading SMALLINT NOT NULL DEFAULT 0,
    speed_kph DOUBLE PRECISION NOT NULL DEFAULT 0,
    fuel_percent SMALLINT NOT NULL DEFAULT 100 CHECK (fuel_percent BETWEEN 0 AND 100),
    active_incident_id VARCHAR(32),
    location_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ld_units_readiness ON live_dispatch.units(status, agency);
CREATE INDEX IF NOT EXISTS idx_ld_units_active_incident ON live_dispatch.units(active_incident_id);

CREATE TABLE IF NOT EXISTS live_dispatch.dispatches (
    id VARCHAR(64) PRIMARY KEY,
    incident_id VARCHAR(32) NOT NULL,
    incident_version INTEGER NOT NULL,
    priority VARCHAR(2) NOT NULL CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
    severity SMALLINT NOT NULL,
    category VARCHAR(80) NOT NULL,
    status VARCHAR(24) NOT NULL CHECK (status IN ('recommended', 'accepted', 'rejected', 'en_route', 'on_scene', 'transporting', 'completed', 'cancelled')),
    is_backup BOOLEAN NOT NULL DEFAULT FALSE,
    unit_id VARCHAR(40) NOT NULL REFERENCES live_dispatch.units(id),
    receiving_facility_id VARCHAR(40) REFERENCES live_dispatch.facilities(id),
    optimization_score DOUBLE PRECISION NOT NULL,
    score_breakdown JSONB NOT NULL,
    alternatives JSONB NOT NULL DEFAULT '[]'::jsonb,
    origin_coordinate JSONB NOT NULL,
    scene_coordinate JSONB NOT NULL,
    destination_coordinate JSONB,
    route_to_scene JSONB NOT NULL,
    route_to_hospital JSONB,
    scene_distance_km DOUBLE PRECISION NOT NULL,
    scene_eta_minutes DOUBLE PRECISION NOT NULL,
    hospital_distance_km DOUBLE PRECISION,
    hospital_eta_minutes DOUBLE PRECISION,
    algorithm_version VARCHAR(32) NOT NULL,
    decision_reason TEXT NOT NULL,
    operator_id TEXT,
    operator_note TEXT,
    rejection_reason TEXT,
    recommended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ld_active_incident_dispatch
    ON live_dispatch.dispatches(incident_id)
    WHERE status IN ('recommended', 'accepted', 'en_route', 'on_scene', 'transporting') AND is_backup = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ld_active_unit_dispatch
    ON live_dispatch.dispatches(unit_id)
    WHERE status IN ('recommended', 'accepted', 'en_route', 'on_scene', 'transporting');
CREATE INDEX IF NOT EXISTS idx_ld_dispatch_queue
    ON live_dispatch.dispatches(status, priority, scene_eta_minutes);

CREATE TABLE IF NOT EXISTS live_dispatch.audit_events (
    id BIGSERIAL PRIMARY KEY,
    dispatch_id VARCHAR(64) REFERENCES live_dispatch.dispatches(id) ON DELETE CASCADE,
    incident_id VARCHAR(32) NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    from_state VARCHAR(24),
    to_state VARCHAR(24),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ld_audit_dispatch ON live_dispatch.audit_events(dispatch_id, id DESC);

CREATE TABLE IF NOT EXISTS live_dispatch.consumer_cursors (
    consumer_name TEXT PRIMARY KEY,
    last_event_id BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO live_dispatch.consumer_cursors(consumer_name, last_event_id)
VALUES ('command-center', 0)
ON CONFLICT (consumer_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS live_dispatch.outbox_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    aggregate_version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ld_outbox_version
    ON live_dispatch.outbox_events(event_type, aggregate_id, aggregate_version);

INSERT INTO live_dispatch.facilities(id, name, facility_type, latitude, longitude, capabilities, ed_load_percent, ambulance_bays)
VALUES
    ('hkl', 'Hospital Kuala Lumpur', 'hospital', 3.1727, 101.7006, '["TRAUMA","ICU","CARDIAC","STROKE"]', 82, 5),
    ('ijn', 'Institut Jantung Negara', 'hospital', 3.1714, 101.7047, '["ICU","CARDIAC"]', 71, 3),
    ('hctm', 'Hospital Canselor Tuanku Muhriz UKM', 'hospital', 3.0985, 101.7275, '["TRAUMA","ICU","STROKE","MATERNAL"]', 76, 4),
    ('umsc', 'UM Specialist Centre', 'hospital', 3.1147, 101.6512, '["TRAUMA","STROKE","MATERNAL"]', 63, 2),
    ('setapak', 'Setapak Emergency Base', 'ambulance_base', 3.1997, 101.7201, '["BLS","ALS"]', 0, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO live_dispatch.units(id, callsign, agency, base_facility_id, status, equipment_type, capabilities, crew, latitude, longitude, fuel_percent)
VALUES
    ('AMB-01', 'Alpha Medic', 'MERS999', 'hkl', 'available', 'ALS', '["ALS","TRAUMA","RESCUE"]', '[{"name":"A. Rahman","role":"Paramedic"},{"name":"S. Lim","role":"EMT"}]', 3.1667, 101.6906, 92),
    ('AMB-02', 'Bravo Cardiac', 'MOH', 'ijn', 'available', 'ALS', '["ALS","CARDIAC","ICU"]', '[{"name":"N. Ismail","role":"Paramedic"},{"name":"K. Tan","role":"EMT"}]', 3.1694, 101.6997, 86),
    ('AMB-03', 'Charlie Response', 'MOH', 'hctm', 'available', 'BLS', '["BLS","TRAUMA"]', '[{"name":"R. Kumar","role":"EMT"},{"name":"F. Noor","role":"EMT"}]', 3.0965, 101.7275, 78),
    ('AMB-04', 'Delta ICU', 'MOH', 'umsc', 'available', 'ICU', '["ALS","ICU","VENTILATOR"]', '[{"name":"M. Chong","role":"Critical Care Paramedic"},{"name":"H. Ali","role":"EMT"}]', 3.1207, 101.6562, 81),
    ('AMB-05', 'Echo Rapid', 'MERS999', 'setapak', 'available', 'ALS', '["ALS","TRAUMA"]', '[{"name":"D. Lee","role":"Paramedic"},{"name":"Z. Omar","role":"EMT"}]', 3.1937, 101.7301, 74),
    ('AMB-06', 'Foxtrot General', 'MOH', 'hkl', 'available', 'BLS', '["BLS"]', '[{"name":"P. Wong","role":"EMT"},{"name":"I. Shah","role":"EMT"}]', 3.1707, 101.6906, 69),
    ('AMB-07', 'Gamma Rescue', 'BOMBA', 'hkl', 'available', 'RESCUE', '["ALS","TRAUMA","RESCUE","EXTRICATION"]', '[{"name":"J. Aziz","role":"Rescue Paramedic"},{"name":"T. Goh","role":"Rescue Tech"}]', 3.1754, 101.6997, 88),
    ('AMB-08', 'Helix Maternal', 'MOH', 'hctm', 'available', 'ALS', '["ALS","MATERNAL","NEONATAL"]', '[{"name":"L. Devi","role":"Paramedic"},{"name":"A. Yusof","role":"EMT"}]', 3.0925, 101.7375, 83),
    ('AMB-09', 'India Neonatal', 'MOH', 'umsc', 'available', 'NEONATAL', '["ALS","NEONATAL","VENTILATOR"]', '[{"name":"C. Ng","role":"Neonatal Paramedic"},{"name":"B. Musa","role":"EMT"}]', 3.1127, 101.6412, 76),
    ('AMB-10', 'Juliet Standby', 'MERS999', 'setapak', 'offline', 'BLS', '["BLS"]', '[{"name":"Standby Crew","role":"EMT"}]', 3.2017, 101.7151, 55)
ON CONFLICT (id) DO NOTHING;

INSERT INTO live_dispatch.schema_migrations(version, description)
VALUES (1, 'Fleet, facilities, optimized dispatch lifecycle, audit, cursor, and outbox')
ON CONFLICT (version) DO NOTHING;
