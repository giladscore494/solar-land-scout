import type { CandidateSite, StateMacro } from "@/types/domain";
import { hydrateStateMacro, computeSiteScore } from "./scoring";
import { passesStrictFilters } from "./filters";
import statesSeed from "@/data/us_states_macro.json";
import sitesSeed from "@/data/candidate_sites.json";
import { getPostgresPool } from "./postgres";
import { ensureSchema } from "./db-schema";
import { kickBanner } from "./startup-banner";

export interface DataRepository {
  listStates(): Promise<StateMacro[]>;
  getState(code: string): Promise<StateMacro | null>;
  listSites(): Promise<CandidateSite[]>;
  listSitesByState(code: string): Promise<CandidateSite[]>;
  getSite(id: string): Promise<CandidateSite | null>;
}

class JsonRepository implements DataRepository {
  private statesCache: StateMacro[] | null = null;
  private sitesCache: CandidateSite[] | null = null;

  private hydrateStates(): StateMacro[] {
    if (this.statesCache) return this.statesCache;
    const raw = statesSeed as StateMacro[];
    this.statesCache = raw
      .map((s) => {
        const hydrated = hydrateStateMacro(s);
        return {
          ...hydrated,
          state_name_en: hydrated.state_name,
          state_name_he: hydrated.state_name_he ?? null,
          macro_summary_en: hydrated.macro_summary_seed,
          macro_summary_he: hydrated.macro_summary_he ?? null,
        };
      })
      .sort((a, b) => b.macro_total_score - a.macro_total_score);
    return this.statesCache;
  }

  private hydrateSites(): CandidateSite[] {
    if (this.sitesCache) return this.sitesCache;
    const raw = sitesSeed as CandidateSite[];
    this.sitesCache = raw.map((s) => {
      const overall_site_score = computeSiteScore(s);
      const withScore: CandidateSite = { ...s, overall_site_score };
      return {
        ...withScore,
        qualification_reasons_json: withScore.qualification_reasons,
        caution_notes_json: withScore.caution_notes,
        gemini_summary_en: withScore.gemini_summary_seed,
        gemini_summary_he: withScore.gemini_summary_he ?? null,
        passes_strict_filters: passesStrictFilters(withScore),
      };
    });
    return this.sitesCache;
  }

  async listStates(): Promise<StateMacro[]> {
    return this.hydrateStates();
  }

  async getState(code: string): Promise<StateMacro | null> {
    const up = code.toUpperCase();
    return this.hydrateStates().find((s) => s.state_code === up) ?? null;
  }

  async listSites(): Promise<CandidateSite[]> {
    return this.hydrateSites();
  }

  async listSitesByState(code: string): Promise<CandidateSite[]> {
    const up = code.toUpperCase();
    return this.hydrateSites().filter((s) => s.state_code === up);
  }

  async getSite(id: string): Promise<CandidateSite | null> {
    return this.hydrateSites().find((s) => s.id === id) ?? null;
  }
}

type DbStateRow = {
  state_code: string;
  state_name_en: string;
  state_name_he: string | null;
  average_solar_potential_score: number;
  electricity_price_score: number;
  land_cost_score: number;
  open_land_availability_score: number;
  development_friendliness_score: number;
  macro_total_score: number;
  macro_summary_en: string | null;
  macro_summary_he: string | null;
  recommended_label: StateMacro["recommended_label"];
};

type DbSiteRow = {
  id: string;
  state_code: string;
  title: string;
  lat: number;
  lng: number;
  solar_resource_value: number;
  estimated_land_cost_band: CandidateSite["estimated_land_cost_band"];
  distance_to_infra_estimate: CandidateSite["distance_to_infra_estimate"];
  slope_estimate: number;
  open_land_score: number;
  passes_strict_filters: boolean;
  qualification_reasons_json: string[] | null;
  caution_notes_json: string[] | null;
  gemini_summary_en: string | null;
  gemini_summary_he: string | null;
  overall_site_score: number;
  feasibility_score?: number | null;
  risk_breakdown_json?: Record<string, unknown> | null;
  still_to_verify_json?: string[] | null;
  gemini_debug_json?: Record<string, unknown> | null;
};

class PostgresRepository implements DataRepository {
  private readonly fallback = new JsonRepository();
  private readonly pool = getPostgresPool();
  private initialized = false;

  private async init(): Promise<boolean> {
    if (!this.pool) return false;

    try {
      if (!this.initialized) {
        await ensureSchema(this.pool);
        await this.seedStatesIfEmpty();
        this.initialized = true;
      }
      return true;
    } catch (error) {
      console.error("[repository] Postgres init failed; using JSON fallback", error);
      return false;
    }
  }

  private async seedStatesIfEmpty(): Promise<void> {
    if (!this.pool) return;
    const countResult = (await this.pool.query(
      "SELECT COUNT(*)::text as count FROM states_macro"
    )) as { rows: { count: string }[] };
    const count = Number(countResult.rows[0]?.count ?? 0);
    if (count > 0) return;

    const seeded = (statesSeed as StateMacro[])
      .map(hydrateStateMacro)
      .map((s) => ({
        state_code: s.state_code,
        state_name_en: s.state_name,
        state_name_he: s.state_name_he ?? null,
        average_solar_potential_score: s.average_solar_potential_score,
        electricity_price_score: s.electricity_price_score,
        land_cost_score: s.land_cost_score,
        open_land_availability_score: s.open_land_availability_score,
        development_friendliness_score: s.development_friendliness_score,
        macro_total_score: s.macro_total_score,
        macro_summary_en: s.macro_summary_seed,
        macro_summary_he: s.macro_summary_he ?? null,
        recommended_label: s.recommended_label,
      }));

    for (const row of seeded) {
      await this.pool.query(
        `INSERT INTO states_macro (
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
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()
        )`,
        [
          row.state_code,
          row.state_name_en,
          row.state_name_he,
          row.average_solar_potential_score,
          row.electricity_price_score,
          row.land_cost_score,
          row.open_land_availability_score,
          row.development_friendliness_score,
          row.macro_total_score,
          row.macro_summary_en,
          row.macro_summary_he,
          row.recommended_label,
        ]
      );
    }
  }

  private mapDbState(row: DbStateRow): StateMacro {
    const state = hydrateStateMacro({
      state_code: row.state_code,
      state_name: row.state_name_en,
      state_name_en: row.state_name_en,
      state_name_he: row.state_name_he,
      average_solar_potential_score: Number(row.average_solar_potential_score),
      electricity_price_score: Number(row.electricity_price_score),
      land_cost_score: Number(row.land_cost_score),
      open_land_availability_score: Number(row.open_land_availability_score),
      development_friendliness_score: Number(row.development_friendliness_score),
      macro_total_score: Number(row.macro_total_score),
      macro_summary_seed: row.macro_summary_en ?? "",
      macro_summary_en: row.macro_summary_en,
      macro_summary_he: row.macro_summary_he,
      recommended_label: row.recommended_label,
    });

    return {
      ...state,
      macro_summary_en: row.macro_summary_en,
      macro_summary_he: row.macro_summary_he,
    };
  }

  private mapDbSite(row: DbSiteRow): CandidateSite {
    return {
      id: row.id,
      state_code: row.state_code,
      state_name: row.state_code,
      title: row.title,
      lat: Number(row.lat),
      lng: Number(row.lng),
      solar_resource_value: Number(row.solar_resource_value),
      estimated_land_cost_band: row.estimated_land_cost_band,
      distance_to_infra_estimate: row.distance_to_infra_estimate,
      slope_estimate: Number(row.slope_estimate),
      open_land_score: Number(row.open_land_score),
      passes_strict_filters: row.passes_strict_filters,
      qualification_reasons: row.qualification_reasons_json ?? [],
      caution_notes: row.caution_notes_json ?? [],
      gemini_summary_seed: row.gemini_summary_en ?? "",
      overall_site_score: Number(row.overall_site_score),
      feasibility_score: Number(row.feasibility_score ?? row.overall_site_score),
      risk_breakdown: row.risk_breakdown_json ?? {},
      still_to_verify_notes: row.still_to_verify_json ?? [],
      gemini_debug_json: row.gemini_debug_json ?? null,
      qualification_reasons_json: row.qualification_reasons_json ?? [],
      caution_notes_json: row.caution_notes_json ?? [],
      gemini_summary_en: row.gemini_summary_en,
      gemini_summary_he: row.gemini_summary_he,
    };
  }

  async listStates(): Promise<StateMacro[]> {
    if (!(await this.init()) || !this.pool) return this.fallback.listStates();

    try {
      const result = (await this.pool.query(
        `SELECT
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
          recommended_label
        FROM states_macro
        ORDER BY macro_total_score DESC`
      )) as { rows: DbStateRow[] };
      return result.rows.map((row) => this.mapDbState(row));
    } catch (error) {
      console.error("[repository] Failed to read states from DB", error);
      return this.fallback.listStates();
    }
  }

  async getState(code: string): Promise<StateMacro | null> {
    const up = code.toUpperCase();
    const states = await this.listStates();
    return states.find((s) => s.state_code === up) ?? null;
  }

  async listSites(): Promise<CandidateSite[]> {
    if (!(await this.init()) || !this.pool) return this.fallback.listSites();

    try {
      const result = (await this.pool.query(
        `SELECT
          id,
          state_code,
          title,
          lat,
          lng,
          solar_resource_value,
          estimated_land_cost_band,
          distance_to_infra_estimate,
          slope_estimate,
          open_land_score,
          passes_strict_filters,
          qualification_reasons_json,
          caution_notes_json,
          gemini_summary_en,
          gemini_summary_he,
          overall_site_score,
          feasibility_score,
          risk_breakdown_json,
          still_to_verify_json,
          gemini_debug_json
        FROM candidate_sites
        ORDER BY overall_site_score DESC`
      )) as { rows: DbSiteRow[] };

      if (result.rows.length === 0) return this.fallback.listSites();
      return result.rows.map((row) => this.mapDbSite(row));
    } catch (error) {
      console.error("[repository] Failed to read sites from DB", error);
      return this.fallback.listSites();
    }
  }

  async listSitesByState(code: string): Promise<CandidateSite[]> {
    const up = code.toUpperCase();
    if (!(await this.init()) || !this.pool) return this.fallback.listSitesByState(up);

    try {
      const result = (await this.pool.query(
        `SELECT
          id,
          state_code,
          title,
          lat,
          lng,
          solar_resource_value,
          estimated_land_cost_band,
          distance_to_infra_estimate,
          slope_estimate,
          open_land_score,
          passes_strict_filters,
          qualification_reasons_json,
          caution_notes_json,
          gemini_summary_en,
          gemini_summary_he,
          overall_site_score,
          feasibility_score,
          risk_breakdown_json,
          still_to_verify_json,
          gemini_debug_json
        FROM candidate_sites
        WHERE state_code = $1
        ORDER BY overall_site_score DESC`,
        [up]
      )) as { rows: DbSiteRow[] };

      if (result.rows.length === 0) return this.fallback.listSitesByState(up);
      return result.rows.map((row) => this.mapDbSite(row));
    } catch (error) {
      console.error("[repository] Failed to read sites by state from DB", error);
      return this.fallback.listSitesByState(up);
    }
  }

  async getSite(id: string): Promise<CandidateSite | null> {
    if (!(await this.init()) || !this.pool) return this.fallback.getSite(id);

    try {
      const result = (await this.pool.query(
        `SELECT
          id,
          state_code,
          title,
          lat,
          lng,
          solar_resource_value,
          estimated_land_cost_band,
          distance_to_infra_estimate,
          slope_estimate,
          open_land_score,
          passes_strict_filters,
          qualification_reasons_json,
          caution_notes_json,
          gemini_summary_en,
          gemini_summary_he,
          overall_site_score,
          feasibility_score,
          risk_breakdown_json,
          still_to_verify_json,
          gemini_debug_json
        FROM candidate_sites
        WHERE id = $1
        LIMIT 1`,
        [id]
      )) as { rows: DbSiteRow[] };

      const row = result.rows[0];
      if (!row) return this.fallback.getSite(id);
      return this.mapDbSite(row);
    } catch (error) {
      console.error("[repository] Failed to read site by id from DB", error);
      return this.fallback.getSite(id);
    }
  }
}

let _repo: DataRepository | null = null;

export function getRepository(): DataRepository {
  kickBanner();
  if (!_repo) {
    _repo = new PostgresRepository();
  }
  return _repo;
}
