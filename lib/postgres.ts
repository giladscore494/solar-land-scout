import { Pool } from "pg";
import type { CandidateSite, Language, StateMacro } from "@/types/domain";
import { loadSeedStates } from "./seed-data";

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;
let initFailed = false;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): Pool | null {
  if (!hasDatabaseUrl()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function ensureDatabaseInitialized(): Promise<void> {
  if (initFailed) throw new Error("db_init_failed");
  if (!hasDatabaseUrl()) throw new Error("db_unconfigured");
  if (!initPromise) {
    initPromise = (async () => {
      const db = getPool();
      if (!db) throw new Error("db_unconfigured");
      await db.query(`
        CREATE TABLE IF NOT EXISTS states_macro (
          id BIGSERIAL PRIMARY KEY,
          state_code TEXT NOT NULL UNIQUE,
          state_name_en TEXT NOT NULL,
          state_name_he TEXT NOT NULL,
          average_solar_potential_score DOUBLE PRECISION NOT NULL,
          electricity_price_score DOUBLE PRECISION NOT NULL,
          land_cost_score DOUBLE PRECISION NOT NULL,
          open_land_availability_score DOUBLE PRECISION NOT NULL,
          development_friendliness_score DOUBLE PRECISION NOT NULL,
          macro_total_score DOUBLE PRECISION NOT NULL,
          macro_summary_en TEXT NOT NULL,
          macro_summary_he TEXT NOT NULL,
          recommended_label TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS analysis_runs (
          id BIGSERIAL PRIMARY KEY,
          state_code TEXT NOT NULL,
          language TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS candidate_sites (
          id TEXT PRIMARY KEY,
          run_id BIGINT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
          state_code TEXT NOT NULL,
          title TEXT NOT NULL,
          lat DOUBLE PRECISION NOT NULL,
          lng DOUBLE PRECISION NOT NULL,
          solar_resource_value DOUBLE PRECISION NOT NULL,
          estimated_land_cost_band TEXT NOT NULL,
          distance_to_infra_estimate TEXT NOT NULL,
          slope_estimate DOUBLE PRECISION NOT NULL,
          open_land_score DOUBLE PRECISION NOT NULL,
          passes_strict_filters BOOLEAN NOT NULL,
          qualification_reasons_json JSONB NOT NULL,
          caution_notes_json JSONB NOT NULL,
          gemini_summary_en TEXT NOT NULL DEFAULT '',
          gemini_summary_he TEXT NOT NULL DEFAULT '',
          overall_site_score DOUBLE PRECISION NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_analysis_runs_state_started
          ON analysis_runs (state_code, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_candidate_sites_run_id
          ON candidate_sites (run_id);
        CREATE INDEX IF NOT EXISTS idx_candidate_sites_state_code
          ON candidate_sites (state_code);
      `);

      const existing = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM states_macro");
      if (Number(existing.rows[0]?.count ?? 0) === 0) {
        const seedStates = loadSeedStates();
        for (const state of seedStates) {
          await upsertStateMacro(db, state);
        }
      }
    })().catch((error) => {
      initFailed = true;
      throw error;
    });
  }
  return initPromise;
}

async function upsertStateMacro(db: Pool, state: StateMacro) {
  await db.query(
    `
      INSERT INTO states_macro (
        state_code,
        state_name_en,
        state_name_he,
        average_solar_potential_score,
        electricity_price_score,
        land_cost_score,
        open_land_availability_score,
        development_friendliness_score,
        macro_total_score,
        macro_summary_en,
        macro_summary_he,
        recommended_label,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()
      )
      ON CONFLICT (state_code) DO UPDATE SET
        state_name_en = EXCLUDED.state_name_en,
        state_name_he = EXCLUDED.state_name_he,
        average_solar_potential_score = EXCLUDED.average_solar_potential_score,
        electricity_price_score = EXCLUDED.electricity_price_score,
        land_cost_score = EXCLUDED.land_cost_score,
        open_land_availability_score = EXCLUDED.open_land_availability_score,
        development_friendliness_score = EXCLUDED.development_friendliness_score,
        macro_total_score = EXCLUDED.macro_total_score,
        macro_summary_en = EXCLUDED.macro_summary_en,
        macro_summary_he = EXCLUDED.macro_summary_he,
        recommended_label = EXCLUDED.recommended_label,
        updated_at = NOW()
    `,
    [
      state.state_code,
      state.state_name_en,
      state.state_name_he,
      state.average_solar_potential_score,
      state.electricity_price_score,
      state.land_cost_score,
      state.open_land_availability_score,
      state.development_friendliness_score,
      state.macro_total_score,
      state.macro_summary_en,
      state.macro_summary_he,
      state.recommended_label,
    ]
  );
}

export function encodeBilingualList(en: string[], he: string[]) {
  return JSON.stringify({ en, he });
}

export function decodeBilingualList(value: unknown): { en: string[]; he: string[] } {
  if (!value || typeof value !== "object") return { en: [], he: [] };
  const raw = value as { en?: unknown; he?: unknown };
  return {
    en: Array.isArray(raw.en) ? raw.en.filter((item): item is string => typeof item === "string") : [],
    he: Array.isArray(raw.he) ? raw.he.filter((item): item is string => typeof item === "string") : [],
  };
}

export function normalizeDbLanguage(value: string): Language {
  return value === "he" ? "he" : "en";
}
