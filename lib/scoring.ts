/**
 * Deterministic scoring engine.
 *
 * Macro state scoring: weighted combination of 5 factors (see scoring-config).
 * Site scoring: deterministic transform of solar resource, slope, open-land,
 * land-cost band, and infra proximity into a single 0–100 score.
 *
 * These functions are PURE — no I/O, no randomness, no LLM.
 */

import type {
  CandidateSite,
  LandCostBand,
  RecommendedLabel,
  StateMacro,
} from "@/types/domain";
import {
  LAND_COST_ORDER,
  MACRO_WEIGHTS,
  TIER_CUTOFFS,
  FEASIBILITY_WEIGHTS,
} from "./scoring-config";

export function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Compute macro_total_score from the five factor sub-scores. */
export function computeMacroTotal(
  s: Pick<
    StateMacro,
    | "average_solar_potential_score"
    | "land_cost_score"
    | "electricity_price_score"
    | "open_land_availability_score"
    | "development_friendliness_score"
  >
): number {
  const total =
    s.average_solar_potential_score * MACRO_WEIGHTS.average_solar_potential_score +
    s.land_cost_score * MACRO_WEIGHTS.land_cost_score +
    s.electricity_price_score * MACRO_WEIGHTS.electricity_price_score +
    s.open_land_availability_score * MACRO_WEIGHTS.open_land_availability_score +
    s.development_friendliness_score *
      MACRO_WEIGHTS.development_friendliness_score;
  return Math.round(clamp(total) * 10) / 10;
}

export function tierFor(score: number): RecommendedLabel {
  if (score >= TIER_CUTOFFS.tier1) return "Tier 1 — Strong";
  if (score >= TIER_CUTOFFS.tier2) return "Tier 2 — Favorable";
  if (score >= TIER_CUTOFFS.tier3) return "Tier 3 — Moderate";
  return "Tier 4 — Marginal";
}

/**
 * Normalize raw macro seed data: recompute totals + tier labels so the engine
 * is always authoritative even if the JSON drifts.
 */
export function hydrateStateMacro(raw: StateMacro): StateMacro {
  const macro_total_score = computeMacroTotal(raw);
  return {
    ...raw,
    macro_total_score,
    recommended_label: tierFor(macro_total_score),
  };
}

/** Map GHI (kWh/m²/day, ~3.5..7.0) to 0..100. */
export function normalizeSolarGhi(ghi: number): number {
  // 3.5 → 0, 7.0 → 100. Clamp outside.
  return clamp(((ghi - 3.5) / (7.0 - 3.5)) * 100);
}

/** Map slope% (0 best, 15+ terrible) to 0..100. */
export function normalizeSlope(slopePercent: number): number {
  if (slopePercent <= 1) return 100;
  if (slopePercent >= 15) return 0;
  return clamp(100 - ((slopePercent - 1) / 14) * 100);
}

export function landCostScoreFromBand(band: LandCostBand): number {
  // low → 100, moderate → 75, elevated → 45, high → 15
  switch (band) {
    case "low":
      return 100;
    case "moderate":
      return 75;
    case "elevated":
      return 45;
    case "high":
      return 15;
  }
}

export function infraScoreFromBand(
  band: "near" | "moderate" | "far"
): number {
  switch (band) {
    case "near":
      return 100;
    case "moderate":
      return 65;
    case "far":
      return 20;
  }
}

/** Return true if band a is cheaper-or-equal to band b. */
export function landCostLeq(a: LandCostBand, b: LandCostBand): boolean {
  return LAND_COST_ORDER.indexOf(a) <= LAND_COST_ORDER.indexOf(b);
}

/**
 * Compute overall_site_score from structured fields.
 * Weights here are local to site-scoring (distinct from macro weights).
 *
 * Hard-zero when the site is ineligible (inside a protected area or flood zone).
 * Soft penalty when `distance_to_infra_km > 10`.
 */
export function computeSiteScore(
  s: Pick<
    CandidateSite,
    | "solar_resource_value"
    | "slope_estimate"
    | "open_land_score"
    | "estimated_land_cost_band"
    | "distance_to_infra_estimate"
  > &
    Partial<
      Pick<
        CandidateSite,
        "in_protected_area" | "in_flood_zone" | "distance_to_infra_km"
      >
    >
): number {
  // Hard-zero on ineligibility.
  if (s.in_protected_area === true || s.in_flood_zone === true) return 0;

  const solar = normalizeSolarGhi(s.solar_resource_value);
  const slope = normalizeSlope(s.slope_estimate);
  const openLand = clamp(s.open_land_score);
  const land = landCostScoreFromBand(s.estimated_land_cost_band);
  const infra = infraScoreFromBand(s.distance_to_infra_estimate);

  // Site-level weights: solar dominates, then slope/openland/land/infra.
  let score =
    solar * 0.4 + slope * 0.15 + openLand * 0.15 + land * 0.2 + infra * 0.1;

  // Soft penalty for very distant infrastructure, using feasibility infra weight.
  if (typeof s.distance_to_infra_km === "number" && s.distance_to_infra_km > 10) {
    const overshoot = Math.min(1, (s.distance_to_infra_km - 10) / 20);
    score -= FEASIBILITY_WEIGHTS.infra * 100 * overshoot;
  }
  return Math.round(clamp(score) * 10) / 10;
}
