BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS parcels (
  id BIGSERIAL PRIMARY KEY,
  apn TEXT,
  source TEXT,
  source_id TEXT,
  state_code TEXT NOT NULL,
  county TEXT,
  county_fips TEXT,
  owner_type TEXT,
  owner_name TEXT,
  zoning TEXT,
  land_use_code TEXT,
  area_acres DOUBLE PRECISION,
  acres DOUBLE PRECISION,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326),
  bbox geometry(Polygon, 4326),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_id)
);

-- Legacy compatibility for databases that already have the older importer schema.
-- The CREATE TABLE blocks define the current structural shape; the ALTER/UPDATE
-- statements below backfill required readiness columns without rebuilding tables.
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS zoning TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS area_acres DOUBLE PRECISION;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS apn TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS county_fips TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS owner_type TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS land_use_code TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS acres DOUBLE PRECISION;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS centroid geometry(Point, 4326);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS bbox geometry(Polygon, 4326);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT NOW();
UPDATE parcels
   SET county = COALESCE(county, county_fips),
       zoning = COALESCE(zoning, land_use_code),
       area_acres = COALESCE(area_acres, acres),
       updated_at = COALESCE(updated_at, imported_at, NOW());

CREATE TABLE IF NOT EXISTS transmission_lines (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT UNIQUE,
  voltage_kv DOUBLE PRECISION,
  owner TEXT,
  status TEXT,
  source TEXT,
  geom geometry(MultiLineString, 4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT NOW();
UPDATE transmission_lines
   SET updated_at = COALESCE(updated_at, imported_at, NOW());

CREATE TABLE IF NOT EXISTS substations (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT UNIQUE,
  name TEXT,
  max_voltage_kv DOUBLE PRECISION,
  owner TEXT,
  status TEXT,
  source TEXT,
  geom geometry(Point, 4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE substations ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE substations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE substations ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE substations ADD COLUMN IF NOT EXISTS max_voltage_kv DOUBLE PRECISION;
ALTER TABLE substations ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE substations ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE substations ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT NOW();
UPDATE substations
   SET updated_at = COALESCE(updated_at, imported_at, NOW());

CREATE TABLE IF NOT EXISTS protected_areas (
  id BIGSERIAL PRIMARY KEY,
  source TEXT,
  source_id TEXT,
  name TEXT,
  category TEXT,
  designation TEXT,
  managing_agency TEXT,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_id)
);

ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS designation TEXT;
ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS managing_agency TEXT;
ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT NOW();
UPDATE protected_areas
   SET category = COALESCE(category, designation),
       updated_at = COALESCE(updated_at, imported_at, NOW());

CREATE TABLE IF NOT EXISTS flood_zones (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT UNIQUE,
  zone TEXT,
  flood_zone TEXT,
  sfha BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS zone TEXT;
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS flood_zone TEXT;
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS sfha BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT NOW();
UPDATE flood_zones
   SET zone = COALESCE(zone, flood_zone),
       updated_at = COALESCE(updated_at, imported_at, NOW());

CREATE TABLE IF NOT EXISTS parcel_scores (
  id BIGSERIAL PRIMARY KEY,
  parcel_id BIGINT NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  run_id BIGINT,
  total_acres NUMERIC(12,4),
  usable_acres NUMERIC(12,4),
  contiguous_usable_acres NUMERIC(12,4),
  shape_regularity NUMERIC(6,4),
  mean_slope_percent NUMERIC(8,4),
  slope_stddev_percent NUMERIC(8,4),
  in_protected_area BOOLEAN NOT NULL DEFAULT FALSE,
  protected_area_name TEXT,
  in_flood_zone BOOLEAN NOT NULL DEFAULT FALSE,
  flood_zone_code TEXT,
  wetlands_pct NUMERIC(6,4),
  distance_to_transmission_km NUMERIC(10,4),
  nearest_transmission_kv NUMERIC(8,2),
  distance_to_substation_km NUMERIC(10,4),
  distance_to_road_km NUMERIC(10,4),
  ghi_kwh_m2_day NUMERIC(8,4),
  overall_score NUMERIC(5,2),
  passes_strict_filters BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provenance_json JSONB,
  UNIQUE(parcel_id, run_id)
);

CREATE TABLE IF NOT EXISTS gis_imports (
  id BIGSERIAL PRIMARY KEY,
  dataset TEXT NOT NULL,
  source_url TEXT,
  row_count INTEGER,
  status TEXT NOT NULL DEFAULT 'started',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(dataset, started_at)
);

CREATE INDEX IF NOT EXISTS idx_parcels_geom ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_parcels_centroid ON parcels USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_parcels_bbox ON parcels USING GIST (bbox);
CREATE INDEX IF NOT EXISTS idx_parcels_state_code ON parcels (state_code);
CREATE INDEX IF NOT EXISTS idx_parcels_state_geom ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_parcels_state_code_id ON parcels (state_code, id);
CREATE INDEX IF NOT EXISTS idx_parcels_county_fips ON parcels (county_fips);
CREATE INDEX IF NOT EXISTS idx_parcels_owner_type ON parcels (owner_type);

CREATE INDEX IF NOT EXISTS idx_transmission_lines_geom ON transmission_lines USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_transmission_lines_voltage ON transmission_lines (voltage_kv);

CREATE INDEX IF NOT EXISTS idx_substations_geom ON substations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_substations_voltage ON substations (max_voltage_kv);

CREATE INDEX IF NOT EXISTS idx_protected_areas_geom ON protected_areas USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_flood_zones_geom ON flood_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_flood_zones_sfha ON flood_zones (sfha);

CREATE INDEX IF NOT EXISTS idx_parcel_scores_parcel_id ON parcel_scores (parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_scores_run_id ON parcel_scores (run_id);
CREATE INDEX IF NOT EXISTS idx_parcel_scores_overall_score ON parcel_scores (overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_parcel_scores_passing ON parcel_scores (passes_strict_filters) WHERE passes_strict_filters = TRUE;

COMMENT ON TABLE parcels IS 'Structural parcel scan table only. This migration creates schema, not parcel data. Import real parcel data separately; if the table is empty, parcel scan must fall back to grid mode.';
COMMENT ON TABLE transmission_lines IS 'Structural parcel scan table only. This migration creates schema, not transmission data. Import real infrastructure data separately before expecting parcel scan matches.';
COMMENT ON TABLE substations IS 'Structural parcel scan table only. This migration creates schema, not substation data. Import real infrastructure data separately before expecting parcel scan matches.';
COMMENT ON TABLE protected_areas IS 'Structural parcel scan table only. This migration creates schema, not protected-area data. Import real GIS overlays separately before expecting parcel scan exclusions.';
COMMENT ON TABLE flood_zones IS 'Structural parcel scan table only. This migration creates schema, not FEMA data. Import real flood-zone data separately before expecting parcel scan exclusions.';

COMMIT;
