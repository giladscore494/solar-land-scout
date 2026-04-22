/**
 * Data repository abstraction.
 *
 * v1 reads from local JSON seed files. The repository interface is designed
 * so a future DB (Postgres, DynamoDB, etc.) can be swapped in without touching
 * API routes or UI code — just implement DataRepository and export a different
 * singleton from getRepository().
 */

import type { CandidateSite, StateMacro } from "@/types/domain";
import { hydrateStateMacro, computeSiteScore } from "./scoring";
import { passesStrictFilters } from "./filters";
import statesSeed from "@/data/us_states_macro.json";
import sitesSeed from "@/data/candidate_sites.json";

export interface DataRepository {
  listStates(): Promise<StateMacro[]>;
  getState(code: string): Promise<StateMacro | null>;
  listSites(): Promise<CandidateSite[]>;
  listSitesByState(code: string): Promise<CandidateSite[]>;
  getSite(id: string): Promise<CandidateSite | null>;
}

/**
 * JSON-backed repository. Hydrates raw seed rows through the deterministic
 * scoring engine so macro_total_score, overall_site_score and strict pass/fail
 * flags are always authoritative even if the JSON drifts.
 */
class JsonRepository implements DataRepository {
  private statesCache: StateMacro[] | null = null;
  private sitesCache: CandidateSite[] | null = null;

  private hydrateStates(): StateMacro[] {
    if (this.statesCache) return this.statesCache;
    const raw = statesSeed as StateMacro[];
    this.statesCache = raw
      .map(hydrateStateMacro)
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

let _repo: DataRepository | null = null;
export function getRepository(): DataRepository {
  if (!_repo) _repo = new JsonRepository();
  return _repo;
}
