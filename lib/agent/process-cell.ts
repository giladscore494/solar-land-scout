import type { CandidateSite } from "@/types/domain";
import type { GridCell } from "./grid";
import { enrichSite } from "@/lib/enrichment/orchestrate";
import { computeSiteScore } from "@/lib/scoring";
import { STRICT_FILTERS } from "@/lib/scoring-config";
import { computeOpenLandScore, computeLandCostBand } from "./open-land-heuristic";

export type RejectionReason =
  | "low_solar"
  | "high_slope"
  | "low_open_land"
  | "expensive_land"
  | "far_infra"
  | "protected"
  | "flood"
  | "low_overall_score"
  | "passed";

export interface CellResult {
  cell: GridCell;
  site: CandidateSite;
  rejectionReason: RejectionReason;
  durationMs: number;
  provenance: CandidateSite["enrichment_provenance"];
}

export async function processCell(
  cell: GridCell,
  _signal?: AbortSignal
): Promise<CellResult> {
  const start = Date.now();

  // Build a draft CandidateSite from the grid cell
  const draft: CandidateSite = {
    id: cell.id,
    run_id: null,
    state_code: cell.stateCode,
    state_name: cell.stateCode,
    title: `${cell.stateCode} grid ${cell.row}-${cell.col}`,
    lat: cell.centerLat,
    lng: cell.centerLng,
    solar_resource_value: 0,
    slope_estimate: 0,
    open_land_score: 50,
    estimated_land_cost_band: "moderate",
    distance_to_infra_estimate: "moderate",
    passes_strict_filters: false,
    qualification_reasons: [],
    caution_notes: [],
    gemini_summary_seed: "",
    overall_site_score: 0,
  };

  // Run Tier 1 enrichers
  let enriched = draft;
  try {
    enriched = await enrichSite(draft, { persist: false });
  } catch {
    enriched = draft;
  }

  // Compute open land score and cost band using heuristic if not set
  if (!enriched.open_land_score || enriched.open_land_score === 50) {
    enriched = {
      ...enriched,
      open_land_score: computeOpenLandScore(enriched),
      estimated_land_cost_band: computeLandCostBand(enriched, cell.stateCode),
    };
  }

  // Recompute overall score
  enriched = {
    ...enriched,
    overall_site_score: computeSiteScore(enriched),
  };

  // Evaluate strict filters and build rejection reason
  const rejectionReason = evaluateRejection(enriched);
  enriched = { ...enriched, passes_strict_filters: rejectionReason === "passed" };

  return {
    cell,
    site: enriched,
    rejectionReason,
    durationMs: Date.now() - start,
    provenance: enriched.enrichment_provenance,
  };
}

function evaluateRejection(site: CandidateSite): RejectionReason {
  if (STRICT_FILTERS.exclude_protected_areas && site.in_protected_area === true) {
    return "protected";
  }
  if (STRICT_FILTERS.exclude_flood_zones && site.in_flood_zone === true) {
    return "flood";
  }
  if (site.solar_resource_value > 0 && site.solar_resource_value < STRICT_FILTERS.min_solar_resource) {
    return "low_solar";
  }
  if (site.slope_estimate > STRICT_FILTERS.max_slope_percent) {
    return "high_slope";
  }
  if (site.open_land_score < STRICT_FILTERS.min_open_land_score) {
    return "low_open_land";
  }
  if (!STRICT_FILTERS.acceptable_land_cost.includes(site.estimated_land_cost_band)) {
    return "expensive_land";
  }
  if (!(STRICT_FILTERS.acceptable_infra as readonly string[]).includes(site.distance_to_infra_estimate)) {
    return "far_infra";
  }
  if (site.overall_site_score < STRICT_FILTERS.min_overall_site_score) {
    return "low_overall_score";
  }
  return "passed";
}
