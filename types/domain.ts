/**
 * Core domain types shared across the deterministic engine, repositories,
 * API routes, and the UI.
 */

export type StateCode = string;
export type Language = "en" | "he";

export type RecommendedLabel =
  | "Tier 1 — Strong"
  | "Tier 2 — Favorable"
  | "Tier 3 — Moderate"
  | "Tier 4 — Marginal";

export type LandCostBand = "low" | "moderate" | "elevated" | "high";
export type InfraProximity = "near" | "moderate" | "far";
export type AnalysisRunStatus = "queued" | "running" | "completed" | "failed";
export type SiteDataSource = "database" | "seed";

export interface StateMacro {
  id?: number;
  state_code: StateCode;
  state_name_en: string;
  state_name_he: string;
  average_solar_potential_score: number;
  electricity_price_score: number;
  land_cost_score: number;
  open_land_availability_score: number;
  development_friendliness_score: number;
  macro_total_score: number;
  macro_summary_en: string;
  macro_summary_he: string;
  recommended_label: RecommendedLabel;
  updated_at?: string;
}

export interface AnalysisRun {
  id: number;
  state_code: StateCode;
  language: Language;
  status: AnalysisRunStatus;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  site_count: number;
}

export interface CandidateSite {
  id: string;
  run_id: number | null;
  state_code: StateCode;
  state_name_en: string;
  state_name_he: string;
  lat: number;
  lng: number;
  title: string;
  solar_resource_value: number;
  estimated_land_cost_band: LandCostBand;
  distance_to_infra_estimate: InfraProximity;
  slope_estimate: number;
  open_land_score: number;
  passes_strict_filters: boolean;
  qualification_reasons_en: string[];
  qualification_reasons_he: string[];
  caution_notes_en: string[];
  caution_notes_he: string[];
  gemini_summary_en: string;
  gemini_summary_he: string;
  overall_site_score: number;
  created_at?: string;
  data_source: SiteDataSource;
}

export interface SiteFilters {
  state_code?: StateCode;
  min_macro_score?: number;
  min_solar?: number;
  max_slope?: number;
  max_land_cost_band?: LandCostBand;
  strict_only?: boolean;
}

export interface StatesResponse {
  states: StateMacro[];
  generated_at: string;
  db_available: boolean;
}

export interface SitesResponse {
  sites: CandidateSite[];
  total_before_filters: number;
  total_after_filters: number;
  generated_at: string;
  db_available: boolean;
  latest_analysis_run: AnalysisRun | null;
}

export interface ExplainResponse {
  kind: "state" | "site";
  summary: string;
  bullets: string[];
  risks: string[];
  from_llm: boolean;
}

export interface AnalysisRunsResponse {
  runs: AnalysisRun[];
  latest_run: AnalysisRun | null;
  db_available: boolean;
}

export interface AnalyzeStateResponse {
  run: AnalysisRun | null;
  sites: CandidateSite[];
  generated_at: string;
  db_available: boolean;
  error?: string;
}
