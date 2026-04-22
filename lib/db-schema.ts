import type { QueryablePool } from "./postgres";

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS states_macro (
  id SERIAL PRIMARY KEY,
  state_code CHAR(2) NOT NULL UNIQUE,
  state_name_en TEXT NOT NULL,
  state_name_he TEXT,
  average_solar_potential_score NUMERIC(5,2) NOT NULL,
  electricity_price_score NUMERIC(5,2) NOT NULL,
  land_cost_score NUMERIC(5,2) NOT NULL,
  open_land_availability_score NUMERIC(5,2) NOT NULL,
  development_friendliness_score NUMERIC(5,2) NOT NULL,
  macro_total_score NUMERIC(5,2) NOT NULL,
  macro_summary_en TEXT,
  macro_summary_he TEXT,
  recommended_label TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id BIGSERIAL PRIMARY KEY,
  state_code CHAR(2) NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  gemini_debug_json JSONB,
  gemini_debug_version TEXT,
  gemini_debug_enabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS candidate_sites (
  id TEXT PRIMARY KEY,
  run_id BIGINT REFERENCES analysis_runs(id) ON DELETE SET NULL,
  state_code CHAR(2) NOT NULL,
  title TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  solar_resource_value NUMERIC(8,3) NOT NULL,
  estimated_land_cost_band TEXT NOT NULL,
  distance_to_infra_estimate TEXT NOT NULL,
  slope_estimate NUMERIC(8,3) NOT NULL,
  open_land_score NUMERIC(5,2) NOT NULL,
  passes_strict_filters BOOLEAN NOT NULL,
  qualification_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  caution_notes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  gemini_summary_en TEXT,
  gemini_summary_he TEXT,
  overall_site_score NUMERIC(5,2) NOT NULL,
  feasibility_score NUMERIC(5,2),
  risk_breakdown_json JSONB,
  still_to_verify_json JSONB,
  gemini_debug_json JSONB,
  land_cost_completion_source TEXT,
  grid_completion_source TEXT,
  land_cost_completion_confidence NUMERIC(5,2),
  grid_completion_confidence NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_sites_state_code ON candidate_sites(state_code);
CREATE INDEX IF NOT EXISTS idx_candidate_sites_run_id ON candidate_sites(run_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_state_code ON analysis_runs(state_code);
`;

let initPromise: Promise<void> | null = null;

export function ensureSchema(pool: QueryablePool): Promise<void> {
  if (!initPromise) {
    initPromise = pool.query(INIT_SQL).then(() => undefined);
  }
  return initPromise;
}
