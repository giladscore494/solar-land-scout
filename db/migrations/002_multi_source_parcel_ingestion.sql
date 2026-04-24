BEGIN;

CREATE TABLE IF NOT EXISTS parcel_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  state_code TEXT NULL,
  county TEXT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  priority INTEGER NOT NULL,
  is_true_parcel BOOLEAN NOT NULL,
  is_public_land BOOLEAN NULL,
  license_note TEXT NULL,
  url TEXT NULL,
  access_method TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcel_import_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT REFERENCES parcel_sources(id),
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS raw_parcel_features (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT REFERENCES parcel_sources(id),
  import_job_id BIGINT REFERENCES parcel_import_jobs(id),
  source_type TEXT NOT NULL,
  source_name TEXT NULL,
  source_url TEXT NULL,
  state_code TEXT NULL,
  county TEXT NULL,
  external_id TEXT NULL,
  apn TEXT NULL,
  owner_name TEXT NULL,
  raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_true_parcel BOOLEAN NOT NULL DEFAULT true,
  is_public_land BOOLEAN NULL,
  geom geometry(MultiPolygon, 4326) NULL,
  centroid geometry(Point, 4326) NULL,
  bbox geometry(Polygon, 4326) NULL,
  area_acres DOUBLE PRECISION NULL,
  geom_hash TEXT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcels_unified (
  id BIGSERIAL PRIMARY KEY,
  unified_key TEXT UNIQUE NULL,
  state_code TEXT NULL,
  county TEXT NULL,
  best_apn TEXT NULL,
  best_external_id TEXT NULL,
  best_source_id TEXT NULL REFERENCES parcel_sources(id),
  best_source_type TEXT NULL,
  best_source_name TEXT NULL,
  is_true_parcel BOOLEAN NOT NULL DEFAULT true,
  is_public_land BOOLEAN NULL,
  confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 1,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326) NULL,
  bbox geometry(Polygon, 4326) NULL,
  area_acres DOUBLE PRECISION NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcel_source_links (
  id BIGSERIAL PRIMARY KEY,
  unified_parcel_id BIGINT REFERENCES parcels_unified(id) ON DELETE CASCADE,
  raw_feature_id BIGINT REFERENCES raw_parcel_features(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES parcel_sources(id),
  source_priority INTEGER NOT NULL,
  overlap_ratio DOUBLE PRECISION NULL,
  dedupe_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcel_duplicate_groups (
  id BIGSERIAL PRIMARY KEY,
  group_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'auto_merged',
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_parcel_features_source_external
  ON raw_parcel_features (source_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_parcel_features_geom ON raw_parcel_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_raw_parcel_features_centroid ON raw_parcel_features USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_raw_parcel_features_bbox ON raw_parcel_features USING GIST (bbox);
CREATE INDEX IF NOT EXISTS idx_raw_parcel_features_state_county_apn
  ON raw_parcel_features (state_code, county, apn);
CREATE INDEX IF NOT EXISTS idx_raw_parcel_features_geom_hash ON raw_parcel_features (geom_hash);

CREATE INDEX IF NOT EXISTS idx_parcels_unified_geom ON parcels_unified USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_parcels_unified_centroid ON parcels_unified USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_parcels_unified_bbox ON parcels_unified USING GIST (bbox);
CREATE INDEX IF NOT EXISTS idx_parcels_unified_state_county_apn
  ON parcels_unified (state_code, county, best_apn);

CREATE INDEX IF NOT EXISTS idx_parcel_source_links_unified_parcel_id ON parcel_source_links (unified_parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_source_links_raw_feature_id ON parcel_source_links (raw_feature_id);
CREATE INDEX IF NOT EXISTS idx_parcel_duplicate_groups_group_key ON parcel_duplicate_groups (group_key);

CREATE OR REPLACE VIEW scanner_parcels AS
SELECT
  id::TEXT AS id,
  best_apn AS apn,
  best_source_name AS source,
  best_external_id AS source_id,
  state_code,
  county AS county_fips,
  NULL::TEXT AS owner_type,
  NULL::TEXT AS owner_name,
  area_acres AS acres,
  geom,
  centroid,
  bbox
FROM parcels_unified;

COMMIT;
