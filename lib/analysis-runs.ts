import type { AnalysisRun, CandidateSite } from "@/types/domain";
import { ensureSchema } from "./db-schema";
import { getPostgresPool } from "./postgres";

function toRun(row: any): AnalysisRun {
  return {
    id: Number(row.id),
    state_code: row.state_code,
    language: row.language,
    status: row.status,
    started_at: new Date(row.started_at).toISOString(),
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    notes: row.notes ?? null,
    gemini_debug_json: row.gemini_debug_json ?? null,
    gemini_debug_version: row.gemini_debug_version ?? null,
    gemini_debug_enabled: Boolean(row.gemini_debug_enabled),
  };
}

export async function createAnalysisRun(stateCode: string, language = "en") {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensureSchema(pool);
  const result = await pool.query(
    `INSERT INTO analysis_runs (state_code, language, status, started_at) VALUES ($1,$2,'running',NOW()) RETURNING *`,
    [stateCode, language]
  );
  return toRun(result.rows[0]);
}

export async function completeAnalysisRun(runId: number, status: string, notes: string, debugJson: unknown) {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensureSchema(pool);
  const result = await pool.query(
    `UPDATE analysis_runs SET status=$2, completed_at=NOW(), notes=$3, gemini_debug_json=$4, gemini_debug_enabled=true, gemini_debug_version='v2' WHERE id=$1 RETURNING *`,
    [runId, status, notes, debugJson]
  );
  return result.rows[0] ? toRun(result.rows[0]) : null;
}

export async function saveCandidateSites(runId: number, sites: CandidateSite[]) {
  const pool = getPostgresPool();
  if (!pool) return;
  await ensureSchema(pool);
  for (const s of sites) {
    await pool.query(
      `INSERT INTO candidate_sites (
        id, run_id, state_code, title, lat, lng,
        solar_resource_value, estimated_land_cost_band, distance_to_infra_estimate,
        slope_estimate, open_land_score, passes_strict_filters,
        qualification_reasons_json, caution_notes_json, gemini_summary_en, gemini_summary_he,
        overall_site_score, feasibility_score, risk_breakdown_json, still_to_verify_json, gemini_debug_json,
        land_cost_completion_source, grid_completion_source,
        land_cost_completion_confidence, grid_completion_confidence, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,
        $10,$11,$12,
        $13::jsonb,$14::jsonb,$15,$16,
        $17,$18,$19::jsonb,$20::jsonb,$21::jsonb,
        $22,$23,
        $24,$25,NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        state_code = EXCLUDED.state_code,
        title = EXCLUDED.title,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        solar_resource_value = EXCLUDED.solar_resource_value,
        estimated_land_cost_band = EXCLUDED.estimated_land_cost_band,
        distance_to_infra_estimate = EXCLUDED.distance_to_infra_estimate,
        slope_estimate = EXCLUDED.slope_estimate,
        open_land_score = EXCLUDED.open_land_score,
        passes_strict_filters = EXCLUDED.passes_strict_filters,
        qualification_reasons_json = EXCLUDED.qualification_reasons_json,
        caution_notes_json = EXCLUDED.caution_notes_json,
        gemini_summary_en = EXCLUDED.gemini_summary_en,
        gemini_summary_he = EXCLUDED.gemini_summary_he,
        overall_site_score = EXCLUDED.overall_site_score,
        feasibility_score = EXCLUDED.feasibility_score,
        risk_breakdown_json = EXCLUDED.risk_breakdown_json,
        still_to_verify_json = EXCLUDED.still_to_verify_json,
        gemini_debug_json = EXCLUDED.gemini_debug_json,
        land_cost_completion_source = EXCLUDED.land_cost_completion_source,
        grid_completion_source = EXCLUDED.grid_completion_source,
        land_cost_completion_confidence = EXCLUDED.land_cost_completion_confidence,
        grid_completion_confidence = EXCLUDED.grid_completion_confidence`,
      [
        s.id,
        runId,
        s.state_code,
        s.title,
        s.lat,
        s.lng,
        s.solar_resource_value,
        s.estimated_land_cost_band,
        s.distance_to_infra_estimate,
        s.slope_estimate,
        s.open_land_score,
        s.passes_strict_filters,
        JSON.stringify(s.qualification_reasons_json ?? s.qualification_reasons),
        JSON.stringify(s.caution_notes_json ?? s.caution_notes),
        s.gemini_summary_en ?? s.gemini_summary_seed,
        s.gemini_summary_he ?? null,
        s.overall_site_score,
        s.feasibility_score ?? s.overall_site_score,
        JSON.stringify(s.risk_breakdown ?? {}),
        JSON.stringify(s.still_to_verify_notes ?? []),
        JSON.stringify(s.gemini_debug_json ?? null),
        s.land_cost_completion_source ?? null,
        s.grid_completion_source ?? null,
        s.land_cost_completion_confidence ?? null,
        s.grid_completion_confidence ?? null,
      ]
    );
  }
}

export async function listAnalysisRuns(stateCode: string) {
  const pool = getPostgresPool();
  if (!pool) return [] as AnalysisRun[];
  await ensureSchema(pool);
  const result = await pool.query(
    `SELECT * FROM analysis_runs WHERE state_code=$1 ORDER BY started_at DESC LIMIT 20`,
    [stateCode]
  );
  return result.rows.map(toRun);
}

export async function getRunDebug(runId: number) {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensureSchema(pool);
  const result = await pool.query(`SELECT gemini_debug_json FROM analysis_runs WHERE id=$1 LIMIT 1`, [runId]);
  return result.rows[0]?.gemini_debug_json ?? null;
}
