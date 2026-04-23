export type StateCode = string;

export interface StateMacro {
  state_code: StateCode;
  state_name: string;
  state_name_en?: string;
  state_name_he?: string | null;
  average_solar_potential_score: number;
  electricity_price_score: number;
  land_cost_score: number;
  open_land_availability_score: number;
  development_friendliness_score: number;
  macro_total_score: number;
  macro_summary_seed: string;
  macro_summary_en?: string | null;
  macro_summary_he?: string | null;
  recommended_label: RecommendedLabel;
}

export type RecommendedLabel =
  | "Tier 1 — Strong"
  | "Tier 2 — Favorable"
  | "Tier 3 — Moderate"
  | "Tier 4 — Marginal";

export type LandCostBand = "low" | "moderate" | "elevated" | "high";
export type InfraProximity = "near" | "moderate" | "far";

export interface EnrichmentProvenance {
  source: string;
  at: string;
  status: "ok" | "timeout" | "error" | "skipped";
  latency_ms: number;
  note?: string;
}

export interface GoogleSolarInsights {
  max_array_m2?: number | null;
  sunshine_hours_yr?: number | null;
  carbon_offset_kg_per_mwh?: number | null;
  available: boolean;
}

export interface CandidateSite {
  id: string;
  state_code: StateCode;
  state_name: string;
  lat: number;
  lng: number;
  title: string;
  solar_resource_value: number;
  estimated_land_cost_band: LandCostBand;
  distance_to_infra_estimate: InfraProximity;
  slope_estimate: number;
  open_land_score: number;
  passes_strict_filters: boolean;
  qualification_reasons: string[];
  qualification_reasons_json?: string[];
  caution_notes: string[];
  caution_notes_json?: string[];
  gemini_summary_seed: string;
  gemini_summary_en?: string | null;
  gemini_summary_he?: string | null;
  overall_site_score: number;
  feasibility_score?: number;
  risk_breakdown?: Record<string, unknown>;
  still_to_verify_notes?: string[];
  run_id?: number | null;
  land_cost_completion_source?: string | null;
  grid_completion_source?: string | null;
  land_cost_completion_confidence?: number | null;
  grid_completion_confidence?: number | null;
  gemini_debug_json?: Record<string, unknown> | null;
  created_at?: string;
  // Tier 1 enrichment (optional/additive)
  distance_to_infra_km?: number | null;
  in_protected_area?: boolean;
  protected_area_name?: string | null;
  flood_zone?: string | null;
  in_flood_zone?: boolean;
  google_solar?: GoogleSolarInsights | null;
  enrichment_provenance?: EnrichmentProvenance[];
  enrichment_updated_at?: string | null;
  // Parcel engine enrichment (optional)
  annual_ghi_kwh_m2?: number | null;
  contiguous_acres?: number | null;
  slope_pct?: number | null;
}

export interface AnalysisRun {
  id: number;
  state_code: StateCode;
  language: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  gemini_debug_json: Record<string, unknown> | null;
  gemini_debug_version: string | null;
  gemini_debug_enabled: boolean;
}

export interface SiteFilters {
  state_code?: StateCode;
  min_macro_score?: number;
  min_solar?: number;
  max_slope?: number;
  max_land_cost_band?: LandCostBand;
  strict_only?: boolean;
  hide_protected?: boolean;
  hide_flood?: boolean;
}

export interface StatesResponse {
  states: StateMacro[];
  generated_at: string;
}

export interface SitesResponse {
  sites: CandidateSite[];
  total_before_filters: number;
  total_after_filters: number;
  generated_at: string;
}

export interface ExplainResponse {
  kind: "state" | "site";
  summary: string;
  bullets: string[];
  risks: string[];
  from_llm: boolean;
}
