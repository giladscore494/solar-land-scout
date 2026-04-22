/**
 * Strict v1 filtering for candidate sites.
 *
 * Two layers:
 *  1. passesStrictFilters — hard eligibility gate. Sites that fail are never
 *     shown on the map. This is the "no maybes" rule from the product spec.
 *  2. applyUserFilters — additional user-controlled narrowing from the sidebar.
 */

import type {
  CandidateSite,
  LandCostBand,
  SiteFilters,
} from "@/types/domain";
import { STRICT_FILTERS } from "./scoring-config";
import { landCostLeq } from "./scoring";

/** Hard pass/fail against the strict v1 thresholds. */
export function passesStrictFilters(s: CandidateSite): boolean {
  if (s.solar_resource_value < STRICT_FILTERS.min_solar_resource) return false;
  if (s.slope_estimate > STRICT_FILTERS.max_slope_percent) return false;
  if (s.open_land_score < STRICT_FILTERS.min_open_land_score) return false;
  if (
    !STRICT_FILTERS.acceptable_land_cost.includes(
      s.estimated_land_cost_band
    )
  ) {
    return false;
  }
  if (
    !(STRICT_FILTERS.acceptable_infra as readonly string[]).includes(
      s.distance_to_infra_estimate
    )
  ) {
    return false;
  }
  if (s.overall_site_score < STRICT_FILTERS.min_overall_site_score) return false;
  return true;
}

/** Apply user-controlled sidebar filters (on top of strict gate when strict_only). */
export function applyUserFilters(
  sites: CandidateSite[],
  filters: SiteFilters
): CandidateSite[] {
  const strictOnly = filters.strict_only !== false; // default ON
  return sites.filter((s) => {
    if (strictOnly && !s.passes_strict_filters) return false;
    if (filters.state_code && s.state_code !== filters.state_code) return false;
    if (
      typeof filters.min_solar === "number" &&
      s.solar_resource_value < filters.min_solar
    ) {
      return false;
    }
    if (
      typeof filters.max_slope === "number" &&
      s.slope_estimate > filters.max_slope
    ) {
      return false;
    }
    if (
      filters.max_land_cost_band &&
      !landCostLeq(s.estimated_land_cost_band, filters.max_land_cost_band)
    ) {
      return false;
    }
    return true;
  });
}

/** Narrow helper for API route input parsing. */
export function parseSiteFilters(params: URLSearchParams): SiteFilters {
  const f: SiteFilters = {};
  const state = params.get("state");
  if (state) f.state_code = state.toUpperCase();

  const minMacro = params.get("min_macro_score");
  if (minMacro !== null) f.min_macro_score = Number(minMacro);

  const minSolar = params.get("min_solar");
  if (minSolar !== null) f.min_solar = Number(minSolar);

  const maxSlope = params.get("max_slope");
  if (maxSlope !== null) f.max_slope = Number(maxSlope);

  const maxCost = params.get("max_land_cost_band");
  if (maxCost && ["low", "moderate", "elevated", "high"].includes(maxCost)) {
    f.max_land_cost_band = maxCost as LandCostBand;
  }

  const strict = params.get("strict_only");
  if (strict !== null) f.strict_only = strict !== "false";

  return f;
}
