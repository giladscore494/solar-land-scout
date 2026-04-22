/**
 * Single source of truth for scoring weights, strict thresholds, and analysis
 * generation heuristics.
 */

import type { LandCostBand } from "@/types/domain";

export const MACRO_WEIGHTS = {
  average_solar_potential_score: 0.35,
  land_cost_score: 0.25,
  electricity_price_score: 0.15,
  open_land_availability_score: 0.15,
  development_friendliness_score: 0.1,
} as const;

export const STRICT_FILTERS = {
  min_solar_resource: 5.0,
  max_slope_percent: 5.0,
  min_open_land_score: 60,
  acceptable_land_cost: ["low", "moderate"] as LandCostBand[],
  acceptable_infra: ["near", "moderate"] as const,
  min_overall_site_score: 65,
} as const;

export const LAND_COST_ORDER: readonly LandCostBand[] = [
  "low",
  "moderate",
  "elevated",
  "high",
];

export const TIER_CUTOFFS = {
  tier1: 78,
  tier2: 66,
  tier3: 52,
} as const;

export const ANALYSIS_CONFIG = {
  gridColumns: 7,
  gridRows: 6,
  maxCandidateSeeds: 18,
  maxPersistedSites: 8,
  maxNrelLookups: 6,
} as const;
