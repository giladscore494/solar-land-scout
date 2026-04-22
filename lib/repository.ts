import type {
  AnalysisRun,
  AnalysisRunStatus,
  CandidateSite,
  Language,
  StateMacro,
} from "@/types/domain";
import { ensureDatabaseInitialized, getPool, decodeBilingualList, encodeBilingualList, hasDatabaseUrl, normalizeDbLanguage } from "./postgres";
import { loadSeedSites, loadSeedStates } from "./seed-data";

export interface DataRepository {
  listStates(): Promise<StateMacro[]>;
  getState(code: string): Promise<StateMacro | null>;
  listSites(): Promise<CandidateSite[]>;
  listSitesByState(code: string): Promise<CandidateSite[]>;
  getSite(id: string): Promise<CandidateSite | null>;
  isDatabaseAvailable(): Promise<boolean>;
  listAnalysisRuns(stateCode: string): Promise<AnalysisRun[]>;
  getLatestAnalysisRun(stateCode: string): Promise<AnalysisRun | null>;
  createAnalysisRun(input: { stateCode: string; language: Language }): Promise<AnalysisRun | null>;
  updateAnalysisRun(
    runId: number,
    patch: { status?: AnalysisRunStatus; completedAt?: string | null; notes?: string | null }
  ): Promise<AnalysisRun | null>;
  replaceRunSites(runId: number, stateCode: string, sites: CandidateSite[]): Promise<void>;
  updateSiteSummaries(
    summaries: Array<{ id: string; gemini_summary_en: string; gemini_summary_he: string }>
  ): Promise<void>;
}

class JsonRepository implements DataRepository {
  private statesCache: StateMacro[] | null = null;
  private sitesCache: CandidateSite[] | null = null;

  private hydrateStates() {
    if (!this.statesCache) this.statesCache = loadSeedStates();
    return this.statesCache;
  }

  private hydrateSites() {
    if (!this.sitesCache) this.sitesCache = loadSeedSites();
    return this.sitesCache;
  }

  async listStates() {
    return this.hydrateStates();
  }

  async getState(code: string) {
    const up = code.toUpperCase();
    return this.hydrateStates().find((state) => state.state_code === up) ?? null;
  }

  async listSites() {
    return this.hydrateSites();
  }

  async listSitesByState(code: string) {
    const up = code.toUpperCase();
    return this.hydrateSites().filter((site) => site.state_code === up);
  }

  async getSite(id: string) {
    return this.hydrateSites().find((site) => site.id === id) ?? null;
  }

  async isDatabaseAvailable() {
    return false;
  }

  async listAnalysisRuns() {
    return [];
  }

  async getLatestAnalysisRun() {
    return null;
  }

  async createAnalysisRun() {
    return null;
  }

  async updateAnalysisRun() {
    return null;
  }

  async replaceRunSites() {
    return;
  }

  async updateSiteSummaries() {
    return;
  }
}

class PostgresRepository implements DataRepository {
  private async db() {
    await ensureDatabaseInitialized();
    const pool = getPool();
    if (!pool) throw new Error("db_unavailable");
    return pool;
  }

  async isDatabaseAvailable() {
    try {
      await this.db();
      return true;
    } catch {
      return false;
    }
  }

  async listStates() {
    const db = await this.db();
    const result = await db.query("SELECT * FROM states_macro ORDER BY macro_total_score DESC, state_code ASC");
    return result.rows.map(mapStateRow);
  }

  async getState(code: string) {
    const db = await this.db();
    const result = await db.query("SELECT * FROM states_macro WHERE state_code = $1 LIMIT 1", [code.toUpperCase()]);
    return result.rows[0] ? mapStateRow(result.rows[0]) : null;
  }

  async listSites() {
    const db = await this.db();
    const result = await db.query(`
      WITH latest_runs AS (
        SELECT DISTINCT ON (state_code) id, state_code
        FROM analysis_runs
        WHERE status = 'completed'
        ORDER BY state_code, started_at DESC, id DESC
      )
      SELECT c.*, s.state_name_en, s.state_name_he
      FROM candidate_sites c
      JOIN latest_runs lr ON lr.id = c.run_id
      JOIN states_macro s ON s.state_code = c.state_code
      ORDER BY c.state_code ASC, c.overall_site_score DESC, c.title ASC
    `);
    return result.rows.map(mapCandidateRow);
  }

  async listSitesByState(code: string) {
    const latestRun = await this.getLatestAnalysisRun(code);
    if (!latestRun || latestRun.status !== "completed") return [];
    const db = await this.db();
    const result = await db.query(
      `
        SELECT c.*, s.state_name_en, s.state_name_he
        FROM candidate_sites c
        JOIN states_macro s ON s.state_code = c.state_code
        WHERE c.run_id = $1
        ORDER BY c.overall_site_score DESC, c.title ASC
      `,
      [latestRun.id]
    );
    return result.rows.map(mapCandidateRow);
  }

  async getSite(id: string) {
    const db = await this.db();
    const result = await db.query(
      `
        SELECT c.*, s.state_name_en, s.state_name_he
        FROM candidate_sites c
        JOIN states_macro s ON s.state_code = c.state_code
        WHERE c.id = $1
        LIMIT 1
      `,
      [id]
    );
    return result.rows[0] ? mapCandidateRow(result.rows[0]) : null;
  }

  async listAnalysisRuns(stateCode: string) {
    const db = await this.db();
    const result = await db.query(
      `
        SELECT r.*, COUNT(c.id)::int AS site_count
        FROM analysis_runs r
        LEFT JOIN candidate_sites c ON c.run_id = r.id
        WHERE r.state_code = $1
        GROUP BY r.id
        ORDER BY r.started_at DESC, r.id DESC
      `,
      [stateCode.toUpperCase()]
    );
    return result.rows.map(mapAnalysisRunRow);
  }

  async getLatestAnalysisRun(stateCode: string) {
    const runs = await this.listAnalysisRuns(stateCode);
    return runs[0] ?? null;
  }

  async createAnalysisRun(input: { stateCode: string; language: Language }) {
    const db = await this.db();
    const result = await db.query(
      `
        INSERT INTO analysis_runs (state_code, language, status, notes)
        VALUES ($1, $2, 'running', NULL)
        RETURNING *, 0::int AS site_count
      `,
      [input.stateCode.toUpperCase(), input.language]
    );
    return result.rows[0] ? mapAnalysisRunRow(result.rows[0]) : null;
  }

  async updateAnalysisRun(
    runId: number,
    patch: { status?: AnalysisRunStatus; completedAt?: string | null; notes?: string | null }
  ) {
    const db = await this.db();
    const current = await db.query(
      `
        SELECT r.*, COUNT(c.id)::int AS site_count
        FROM analysis_runs r
        LEFT JOIN candidate_sites c ON c.run_id = r.id
        WHERE r.id = $1
        GROUP BY r.id
        LIMIT 1
      `,
      [runId]
    );
    if (!current.rows[0]) return null;
    const next = current.rows[0];
    const result = await db.query(
      `
        UPDATE analysis_runs
        SET status = $2,
            completed_at = $3,
            notes = $4
        WHERE id = $1
        RETURNING *
      `,
      [
        runId,
        patch.status ?? next.status,
        patch.completedAt === undefined ? next.completed_at : patch.completedAt,
        patch.notes === undefined ? next.notes : patch.notes,
      ]
    );
    const refreshed = await db.query(
      `
        SELECT r.*, COUNT(c.id)::int AS site_count
        FROM analysis_runs r
        LEFT JOIN candidate_sites c ON c.run_id = r.id
        WHERE r.id = $1
        GROUP BY r.id
        LIMIT 1
      `,
      [runId]
    );
    if (refreshed.rows[0]) return mapAnalysisRunRow(refreshed.rows[0]);
    if (result.rows[0]) return mapAnalysisRunRow({ ...result.rows[0], site_count: next.site_count });
    return null;
  }

  async replaceRunSites(runId: number, stateCode: string, sites: CandidateSite[]) {
    const db = await this.db();
    await db.query("DELETE FROM candidate_sites WHERE run_id = $1", [runId]);
    for (const site of sites) {
      await db.query(
        `
          INSERT INTO candidate_sites (
            id,
            run_id,
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
            overall_site_score
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17
          )
        `,
        [
          site.id,
          runId,
          stateCode.toUpperCase(),
          site.title,
          site.lat,
          site.lng,
          site.solar_resource_value,
          site.estimated_land_cost_band,
          site.distance_to_infra_estimate,
          site.slope_estimate,
          site.open_land_score,
          site.passes_strict_filters,
          encodeBilingualList(site.qualification_reasons_en, site.qualification_reasons_he),
          encodeBilingualList(site.caution_notes_en, site.caution_notes_he),
          site.gemini_summary_en,
          site.gemini_summary_he,
          site.overall_site_score,
        ]
      );
    }
  }

  async updateSiteSummaries(
    summaries: Array<{ id: string; gemini_summary_en: string; gemini_summary_he: string }>
  ) {
    if (!summaries.length) return;
    const db = await this.db();
    for (const summary of summaries) {
      await db.query(
        `
          UPDATE candidate_sites
          SET gemini_summary_en = $2,
              gemini_summary_he = $3
          WHERE id = $1
        `,
        [summary.id, summary.gemini_summary_en, summary.gemini_summary_he]
      );
    }
  }
}

class HybridRepository implements DataRepository {
  constructor(
    private readonly jsonRepository: JsonRepository,
    private readonly postgresRepository: PostgresRepository | null
  ) {}

  async listStates() {
    if (!this.postgresRepository) return this.jsonRepository.listStates();
    try {
      return await this.postgresRepository.listStates();
    } catch {
      return this.jsonRepository.listStates();
    }
  }

  async getState(code: string) {
    if (!this.postgresRepository) return this.jsonRepository.getState(code);
    try {
      return (await this.postgresRepository.getState(code)) ?? this.jsonRepository.getState(code);
    } catch {
      return this.jsonRepository.getState(code);
    }
  }

  async listSites() {
    if (!this.postgresRepository) return this.jsonRepository.listSites();
    try {
      const databaseSites = await this.postgresRepository.listSites();
      return databaseSites.length ? databaseSites : this.jsonRepository.listSites();
    } catch {
      return this.jsonRepository.listSites();
    }
  }

  async listSitesByState(code: string) {
    if (!this.postgresRepository) return this.jsonRepository.listSitesByState(code);
    try {
      const latestRun = await this.postgresRepository.getLatestAnalysisRun(code);
      if (!latestRun) return this.jsonRepository.listSitesByState(code);
      return this.postgresRepository.listSitesByState(code);
    } catch {
      return this.jsonRepository.listSitesByState(code);
    }
  }

  async getSite(id: string) {
    if (!this.postgresRepository) return this.jsonRepository.getSite(id);
    try {
      return (await this.postgresRepository.getSite(id)) ?? this.jsonRepository.getSite(id);
    } catch {
      return this.jsonRepository.getSite(id);
    }
  }

  async isDatabaseAvailable() {
    if (!this.postgresRepository) return false;
    return this.postgresRepository.isDatabaseAvailable();
  }

  async listAnalysisRuns(stateCode: string) {
    if (!this.postgresRepository) return [];
    try {
      return await this.postgresRepository.listAnalysisRuns(stateCode);
    } catch {
      return [];
    }
  }

  async getLatestAnalysisRun(stateCode: string) {
    if (!this.postgresRepository) return null;
    try {
      return await this.postgresRepository.getLatestAnalysisRun(stateCode);
    } catch {
      return null;
    }
  }

  async createAnalysisRun(input: { stateCode: string; language: Language }) {
    if (!this.postgresRepository) return null;
    return this.postgresRepository.createAnalysisRun(input);
  }

  async updateAnalysisRun(
    runId: number,
    patch: { status?: AnalysisRunStatus; completedAt?: string | null; notes?: string | null }
  ) {
    if (!this.postgresRepository) return null;
    return this.postgresRepository.updateAnalysisRun(runId, patch);
  }

  async replaceRunSites(runId: number, stateCode: string, sites: CandidateSite[]) {
    if (!this.postgresRepository) return;
    return this.postgresRepository.replaceRunSites(runId, stateCode, sites);
  }

  async updateSiteSummaries(
    summaries: Array<{ id: string; gemini_summary_en: string; gemini_summary_he: string }>
  ) {
    if (!this.postgresRepository) return;
    return this.postgresRepository.updateSiteSummaries(summaries);
  }
}

function mapStateRow(row: Record<string, unknown>): StateMacro {
  return {
    id: Number(row.id),
    state_code: String(row.state_code),
    state_name_en: String(row.state_name_en),
    state_name_he: String(row.state_name_he),
    average_solar_potential_score: Number(row.average_solar_potential_score),
    electricity_price_score: Number(row.electricity_price_score),
    land_cost_score: Number(row.land_cost_score),
    open_land_availability_score: Number(row.open_land_availability_score),
    development_friendliness_score: Number(row.development_friendliness_score),
    macro_total_score: Number(row.macro_total_score),
    macro_summary_en: String(row.macro_summary_en),
    macro_summary_he: String(row.macro_summary_he),
    recommended_label: String(row.recommended_label) as StateMacro["recommended_label"],
    updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : undefined,
  };
}

function mapCandidateRow(row: Record<string, unknown>): CandidateSite {
  const reasons = decodeBilingualList(row.qualification_reasons_json as object | null);
  const cautions = decodeBilingualList(row.caution_notes_json as object | null);
  return {
    id: String(row.id),
    run_id: row.run_id == null ? null : Number(row.run_id),
    state_code: String(row.state_code),
    state_name_en: String(row.state_name_en),
    state_name_he: String(row.state_name_he),
    lat: Number(row.lat),
    lng: Number(row.lng),
    title: String(row.title),
    solar_resource_value: Number(row.solar_resource_value),
    estimated_land_cost_band: String(row.estimated_land_cost_band) as CandidateSite["estimated_land_cost_band"],
    distance_to_infra_estimate: String(row.distance_to_infra_estimate) as CandidateSite["distance_to_infra_estimate"],
    slope_estimate: Number(row.slope_estimate),
    open_land_score: Number(row.open_land_score),
    passes_strict_filters: Boolean(row.passes_strict_filters),
    qualification_reasons_en: reasons.en,
    qualification_reasons_he: reasons.he,
    caution_notes_en: cautions.en,
    caution_notes_he: cautions.he,
    gemini_summary_en: String(row.gemini_summary_en ?? ""),
    gemini_summary_he: String(row.gemini_summary_he ?? ""),
    overall_site_score: Number(row.overall_site_score),
    created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
    data_source: "database",
  };
}

function mapAnalysisRunRow(row: Record<string, unknown>): AnalysisRun {
  return {
    id: Number(row.id),
    state_code: String(row.state_code),
    language: normalizeDbLanguage(String(row.language)),
    status: String(row.status) as AnalysisRunStatus,
    started_at: new Date(String(row.started_at)).toISOString(),
    completed_at: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    notes: row.notes ? String(row.notes) : null,
    site_count: Number(row.site_count ?? 0),
  };
}

let repositorySingleton: DataRepository | null = null;

export function getRepository(): DataRepository {
  if (!repositorySingleton) {
    repositorySingleton = new HybridRepository(
      new JsonRepository(),
      hasDatabaseUrl() ? new PostgresRepository() : null
    );
  }
  return repositorySingleton;
}
