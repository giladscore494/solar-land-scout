import type { QueryablePool } from "./postgres";

const SPATIAL_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS parcels (
  id BIGSERIAL PRIMARY KEY,
  apn TEXT,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  state_code CHAR(2),
  county_fips CHAR(5),
  owner_type TEXT,
  owner_name TEXT,
  land_use_code TEXT,
  acres NUMERIC(12,4),
  geom geometry(MultiPolygon, 4326),
  centroid geometry(Point, 4326),
  bbox geometry(Polygon, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_parcels_geom ON parcels USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_parcels_centroid ON parcels USING GIST(centroid);
CREATE INDEX IF NOT EXISTS idx_parcels_bbox ON parcels USING GIST(bbox);
CREATE INDEX IF NOT EXISTS idx_parcels_state_code ON parcels(state_code);
CREATE INDEX IF NOT EXISTS idx_parcels_county_fips ON parcels(county_fips);
CREATE INDEX IF NOT EXISTS idx_parcels_owner_type ON parcels(owner_type);

CREATE TABLE IF NOT EXISTS transmission_lines (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  voltage_kv NUMERIC(8,2),
  owner TEXT,
  status TEXT,
  geom geometry(LineString, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transmission_lines_geom ON transmission_lines USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_transmission_lines_voltage ON transmission_lines(voltage_kv);

CREATE TABLE IF NOT EXISTS substations (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  name TEXT,
  max_voltage_kv NUMERIC(8,2),
  owner TEXT,
  status TEXT,
  geom geometry(Point, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_substations_geom ON substations USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_substations_voltage ON substations(max_voltage_kv);

CREATE TABLE IF NOT EXISTS protected_areas (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT,
  designation TEXT,
  managing_agency TEXT,
  geom geometry(MultiPolygon, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_protected_areas_geom ON protected_areas USING GIST(geom);

CREATE TABLE IF NOT EXISTS flood_zones (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  flood_zone TEXT,
  sfha BOOLEAN NOT NULL DEFAULT FALSE,
  geom geometry(MultiPolygon, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_zones_geom ON flood_zones USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_flood_zones_sfha ON flood_zones(sfha);

CREATE TABLE IF NOT EXISTS wetlands (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  wetland_type TEXT,
  geom geometry(MultiPolygon, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wetlands_geom ON wetlands USING GIST(geom);

CREATE TABLE IF NOT EXISTS roads (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  road_class TEXT,
  name TEXT,
  geom geometry(LineString, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roads_geom ON roads USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_roads_class ON roads(road_class);

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
CREATE INDEX IF NOT EXISTS idx_parcel_scores_parcel_id ON parcel_scores(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_scores_run_id ON parcel_scores(run_id);
CREATE INDEX IF NOT EXISTS idx_parcel_scores_overall_score ON parcel_scores(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_parcel_scores_passing ON parcel_scores(passes_strict_filters) WHERE passes_strict_filters = TRUE;

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
`;

let initPromise: Promise<void> | null = null;

export async function ensureSpatialSchema(pool: QueryablePool): Promise<void> {
  if (!initPromise) {
    initPromise = pool.query(SPATIAL_SCHEMA_SQL).then(() => undefined);
  }
  return initPromise;
}
