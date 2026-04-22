/**
 * Core domain types for Solar Land Scout v1.
 * These shapes are the contract between data/seeds, scoring engine,
 * API routes, and the UI. Keep them stable — changes ripple everywhere.
 */

/** 2-letter USPS state code. */
export type StateCode = string;

/**
 * Macro-level ranking for a U.S. state. All score fields are 0–100.
 * Seed values may be manually curated in v1 and progressively replaced
 * by live sources (e.g. NREL solar, EIA electricity price) later.
 */
export interface StateMacro {
  state_code: StateCode;
  state_name: string;
  average_solar_potential_score: number;
  electricity_price_score: number;
  land_cost_score: number;
  open_land_availability_score: number;
  development_friendliness_score: number;
  /** Computed from the five factors using weights in lib/scoring-config.ts. */
  macro_total_score: number;
  macro_summary_seed: string;
  recommended_label: RecommendedLabel;
}

export type RecommendedLabel =
  | "Tier 1 — Strong"
  | "Tier 2 — Favorable"
  | "Tier 3 — Moderate"
  | "Tier 4 — Marginal";

/** Qualitative bands used where precise $/acre data is not yet wired up. */
export type LandCostBand = "low" | "moderate" | "elevated" | "high";

/** Qualitative infrastructure proximity estimate (transmission / substations). */
export type InfraProximity = "near" | "moderate" | "far";

/**
 * A pre-filtered candidate site. Only sites that pass the strict v1 filters
 * are exposed to the map UI. No "maybe" points are shown.
 */
export interface CandidateSite {
  id: string;
  state_code: StateCode;
  state_name: string;
  lat: number;
  lng: number;
  title: string;
  /** NREL-style GHI (kWh/m²/day). Higher is better. */
  solar_resource_value: number;
  estimated_land_cost_band: LandCostBand;
  /** Qualitative placeholder until parcel-grade data lands. */
  distance_to_infra_estimate: InfraProximity;
  /** Percent slope estimate. Lower is better for utility-scale PV. */
  slope_estimate: number;
  open_land_score: number; // 0-100
  passes_strict_filters: boolean;
  qualification_reasons: string[];
  caution_notes: string[];
  gemini_summary_seed: string;
  overall_site_score: number; // 0-100
}

/** User-facing filter values controlled from the sidebar. */
export interface SiteFilters {
  state_code?: StateCode;
  min_macro_score?: number;
  min_solar?: number;
  max_slope?: number;
  max_land_cost_band?: LandCostBand;
  strict_only?: boolean;
}

/** Return shape of GET /api/states. */
export interface StatesResponse {
  states: StateMacro[];
  generated_at: string;
}

/** Return shape of GET /api/sites. */
export interface SitesResponse {
  sites: CandidateSite[];
  total_before_filters: number;
  total_after_filters: number;
  generated_at: string;
}

/** Return shape of POST /api/explain. */
export interface ExplainResponse {
  kind: "state" | "site";
  summary: string;
  bullets: string[];
  risks: string[];
  /** true when the explanation came from the Gemini API, false = local fallback. */
  from_llm: boolean;
}
