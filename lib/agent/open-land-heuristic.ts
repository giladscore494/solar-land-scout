/**
 * v1 open-land score and land cost band heuristic.
 *
 * This is a v1 heuristic until NLCD/CDL + parcel data are integrated.
 *
 * open_land_score: derived from infra distance, slope, and protected status.
 * estimated_land_cost_band: derived from state macro land_cost_score and infra proximity.
 */

import type { CandidateSite, LandCostBand } from "@/types/domain";

// State-level land cost approximation (lower = cheaper land)
// Based on general US land market knowledge
const STATE_LAND_COST_TIER: Record<string, number> = {
  // High-cost states
  CA: 80, NJ: 78, MA: 77, CT: 76, NY: 75, MD: 73, WA: 71, OR: 70, CO: 69, HI: 90,
  // Moderate-cost
  FL: 60, VA: 58, GA: 55, TX: 52, AZ: 50, NV: 50, NC: 48, TN: 47, SC: 46, UT: 55,
  // Lower-cost
  AL: 35, AR: 30, MS: 28, LA: 32, OK: 30, KS: 28, NE: 27, SD: 25, ND: 24, MT: 26,
  WY: 24, ID: 35, NM: 30, MN: 38, IA: 35, MO: 35, IN: 38, OH: 40, MI: 38,
  IL: 42, WI: 38, KY: 35, WV: 28, PA: 45, DE: 55, RI: 70, VT: 50, NH: 55, ME: 40,
  AK: 20, DC: 95,
};

/**
 * Compute a v1 open land score (0-100) from enrichment data.
 * Formula: 80 – 5×(infra_km clamped 0..10) – 10×(slope% clamped 0..10) – (protected ? 100 : 0)
 */
export function computeOpenLandScore(site: CandidateSite): number {
  const infraKm = typeof site.distance_to_infra_km === "number"
    ? Math.min(10, Math.max(0, site.distance_to_infra_km))
    : bandToInfraKm(site.distance_to_infra_estimate);

  const slopeClamped = Math.min(10, Math.max(0, site.slope_estimate));
  const isProtected = site.in_protected_area === true;

  const score = 80 - 5 * infraKm - 10 * slopeClamped - (isProtected ? 100 : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function bandToInfraKm(band: string): number {
  switch (band) {
    case "near": return 2;
    case "moderate": return 6;
    case "far": return 12;
    default: return 6;
  }
}

/**
 * Compute v1 land cost band from state-level tier and infra proximity.
 */
export function computeLandCostBand(site: CandidateSite, stateCode: string): LandCostBand {
  const stateCostTier = STATE_LAND_COST_TIER[stateCode.toUpperCase()] ?? 50;

  const infraKm = typeof site.distance_to_infra_km === "number"
    ? site.distance_to_infra_km
    : bandToInfraKm(site.distance_to_infra_estimate);

  // Urban proxy: lower infra distance = more urban = higher land cost
  const urbanPenalty = Math.max(0, (10 - Math.min(10, infraKm)) * 2);

  const combined = stateCostTier + urbanPenalty;

  if (combined >= 75) return "high";
  if (combined >= 55) return "elevated";
  if (combined >= 35) return "moderate";
  return "low";
}
