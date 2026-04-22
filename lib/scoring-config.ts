/**
 * Single source of truth for scoring weights and strict filter thresholds.
 * Tune here — nothing else downstream should hardcode these numbers.
 */

import type { LandCostBand } from "@/types/domain";

/** Macro weights must sum to 1.0. Update carefully. */
export const MACRO_WEIGHTS = {
  average_solar_potential_score: 0.35,
  land_cost_score: 0.25,
  electricity_price_score: 0.15,
  open_land_availability_score: 0.15,
  development_friendliness_score: 0.1,
} as const;

/** Strict v1 filter thresholds. A site must clear ALL of these. */
export const STRICT_FILTERS = {
  /** Min NREL-style GHI (kWh/m²/day). ~5.0 is a reasonable utility-scale floor. */
  min_solar_resource: 5.0,
  /** Max site slope in percent. Utility-scale PV strongly prefers <5%. */
  max_slope_percent: 5.0,
  /** Minimum open-land score 0-100. */
  min_open_land_score: 60,
  /** Acceptable land-cost bands. */
  acceptable_land_cost: ["low", "moderate"] as LandCostBand[],
  /** Acceptable infrastructure proximity. */
  acceptable_infra: ["near", "moderate"] as const,
  /** Minimum overall computed site score. */
  min_overall_site_score: 65,
} as const;

/** Ordered land-cost bands for comparisons. Index = cheaper → more expensive. */
export const LAND_COST_ORDER: readonly LandCostBand[] = [
  "low",
  "moderate",
  "elevated",
  "high",
];

/** Tier cutoffs for the macro ranking label, applied to macro_total_score. */
export const TIER_CUTOFFS = {
  tier1: 78,
  tier2: 66,
  tier3: 52,
} as const;


export const FEASIBILITY_THRESHOLDS = {
  max_slope_percent: 6,
  max_flood_risk_score: 70,
  max_wetlands_impact_score: 55,
  exclude_protected_areas: true,
  min_feasibility_score: 62,
};

export const FEASIBILITY_WEIGHTS = {
  solar: 0.3,
  slope: 0.18,
  openLand: 0.16,
  landCost: 0.14,
  infra: 0.1,
  floodPenalty: 0.06,
  wetlandsPenalty: 0.06,
};
