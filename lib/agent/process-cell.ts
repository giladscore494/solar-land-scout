import type { CandidateSite, EnrichmentProvenance } from "@/types/domain";
import type { GridCellDiagnostics, GridCellMetrics } from "@/types/grid-scan";
import type { GridCell } from "./grid";
import { enrichSite } from "@/lib/enrichment/orchestrate";
import { clamp, normalizeSolarGhi, normalizeSlope } from "@/lib/scoring";
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
  diagnostics: GridCellDiagnostics;
}

export const GRID_RESEARCH_MODE_DEFAULT = process.env.GRID_RESEARCH_MODE !== "false";

const MAX_HARD_REJECT_SLOPE_PERCENT = 15;
const MIN_HARD_REJECT_OPEN_LAND_PCT = 10;
const MIN_HARD_REJECT_GHI = 4.0;
const MAX_HARD_REJECT_PROTECTED_AREA_PCT = 90;
const MAX_HARD_REJECT_WATER_URBAN_PCT = 90;
const MIN_BORDERLINE_SCORE = 40;
const MODERATE_SLOPE_MIN = 6;
const MODERATE_SLOPE_MAX = 15;
const MAX_MODERATE_SLOPE_PENALTY = 20;
const MODERATE_OPEN_LAND_MIN = 10;
const MODERATE_OPEN_LAND_MAX = 35;
const MAX_MODERATE_OPEN_LAND_PENALTY = 20;
const MODERATE_INFRA_DISTANCE_KM = 15;
const MAX_FAR_INFRA_PENALTY = 15;
const DATA_UNKNOWN_KEYS: Array<keyof GridCellMetrics> = [
  "mean_slope_percent",
  "open_land_pct",
  "ghi_kwh_m2_day",
  "distance_to_transmission_km",
  "protected_area_pct",
];
// Unknown metrics get a conservative mid-low component score: enough to avoid
// automatic hard rejection, but still penalized until real data arrives.
const UNKNOWN_METRIC_COMPONENT_SCORE = 40;

export async function processCell(
  cell: GridCell,
  _signal?: AbortSignal,
  options: { researchMode?: boolean } = {}
): Promise<CellResult> {
  const start = Date.now();

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

  let enriched = draft;
  try {
    enriched = await enrichSite(draft, { persist: false });
  } catch {
    enriched = draft;
  }

  if (!enriched.open_land_score || enriched.open_land_score === 50) {
    enriched = {
      ...enriched,
      open_land_score: computeOpenLandScore(enriched),
      estimated_land_cost_band: computeLandCostBand(enriched, cell.stateCode),
    };
  }

  const evaluation = evaluateCell(enriched, options);
  enriched = {
    ...enriched,
    overall_site_score: evaluation.score,
    passes_strict_filters: evaluation.candidate_kind === "strict_pass",
    caution_notes: dedupe([...enriched.caution_notes, ...evaluation.warnings]),
  };

  return {
    cell,
    site: enriched,
    rejectionReason: evaluation.candidate_kind === "strict_pass" ? "passed" : evaluationReason(enriched, evaluation),
    durationMs: Date.now() - start,
    provenance: enriched.enrichment_provenance,
    diagnostics: evaluation,
  };
}

function evaluateCell(
  site: CandidateSite,
  options: { researchMode?: boolean } = {}
): GridCellDiagnostics {
  const researchMode = options.researchMode ?? GRID_RESEARCH_MODE_DEFAULT;
  const provenance = toProvenanceMap(site.enrichment_provenance);
  const solarKnown = isKnown(provenance, "nasa_power") || site.solar_resource_value > 0;
  const slopeKnown = isKnown(provenance, "usgs_elevation");
  const infraKnown = isKnown(provenance, "osm_infra");
  const protectedKnown = isKnown(provenance, "usgs_padus");
  const floodKnown = isKnown(provenance, "fema_flood");
  const envKnown = protectedKnown && floodKnown;

  const metrics: GridCellMetrics = {
    mean_slope_percent: slopeKnown ? site.slope_estimate : null,
    open_land_pct: slopeKnown && infraKnown ? clamp(site.open_land_score) : null,
    ghi_kwh_m2_day: solarKnown ? site.solar_resource_value : null,
    distance_to_transmission_km: infraKnown ? site.distance_to_infra_km ?? null : null,
    protected_area_pct: protectedKnown ? (site.in_protected_area ? 100 : 0) : null,
    water_pct: null,
    urban_pct: null,
  };

  const warnings: string[] = [];
  if (!slopeKnown) warnings.push("slope_unknown");
  if (!(slopeKnown && infraKnown)) warnings.push("open_land_unknown");
  if (!solarKnown) warnings.push("solar_unknown");
  if (!infraKnown) warnings.push("grid_proximity_unknown");
  if (!envKnown) warnings.push("environmental_constraints_unknown");
  if (!protectedKnown) warnings.push("protected_area_unknown");

  const score = computeGridScore(site, metrics, { solarKnown, slopeKnown, infraKnown, envKnown });
  const thresholds = {
    max_hard_reject_slope_percent: MAX_HARD_REJECT_SLOPE_PERCENT,
    min_hard_reject_open_land_pct: MIN_HARD_REJECT_OPEN_LAND_PCT,
    min_hard_reject_ghi_kwh_m2_day: MIN_HARD_REJECT_GHI,
    max_hard_reject_protected_area_pct: MAX_HARD_REJECT_PROTECTED_AREA_PCT,
    max_hard_reject_water_pct: MAX_HARD_REJECT_WATER_URBAN_PCT,
    max_hard_reject_urban_pct: MAX_HARD_REJECT_WATER_URBAN_PCT,
    strict_max_slope_percent: STRICT_FILTERS.max_slope_percent,
    strict_min_open_land_pct: STRICT_FILTERS.min_open_land_score,
    strict_min_ghi_kwh_m2_day: STRICT_FILTERS.min_solar_resource,
    strict_min_score: STRICT_FILTERS.min_overall_site_score,
  };

  const protectedHardReject =
    metrics.protected_area_pct !== null && metrics.protected_area_pct > MAX_HARD_REJECT_PROTECTED_AREA_PCT;
  const slopeHardReject =
    metrics.mean_slope_percent !== null && metrics.mean_slope_percent > MAX_HARD_REJECT_SLOPE_PERCENT;
  const openLandHardReject =
    metrics.open_land_pct !== null && metrics.open_land_pct < MIN_HARD_REJECT_OPEN_LAND_PCT;
  const solarHardReject =
    metrics.ghi_kwh_m2_day !== null && metrics.ghi_kwh_m2_day < MIN_HARD_REJECT_GHI;
  const waterHardReject = metrics.water_pct !== null && metrics.water_pct > MAX_HARD_REJECT_WATER_URBAN_PCT;
  const urbanHardReject = metrics.urban_pct !== null && metrics.urban_pct > MAX_HARD_REJECT_WATER_URBAN_PCT;

  if (
    site.in_flood_zone === true ||
    protectedHardReject ||
    slopeHardReject ||
    openLandHardReject ||
    solarHardReject ||
    waterHardReject ||
    urbanHardReject
  ) {
    return { score, candidate_kind: "hard_reject", borderline: false, warnings, metrics, thresholds };
  }

  const strictPasses =
    metrics.ghi_kwh_m2_day !== null &&
    metrics.ghi_kwh_m2_day >= STRICT_FILTERS.min_solar_resource &&
    metrics.mean_slope_percent !== null &&
    metrics.mean_slope_percent <= STRICT_FILTERS.max_slope_percent &&
    metrics.open_land_pct !== null &&
    metrics.open_land_pct >= STRICT_FILTERS.min_open_land_score &&
    STRICT_FILTERS.acceptable_land_cost.includes(site.estimated_land_cost_band) &&
    (STRICT_FILTERS.acceptable_infra as readonly string[]).includes(site.distance_to_infra_estimate) &&
     score >= STRICT_FILTERS.min_overall_site_score;

  if (strictPasses) {
    return { score, candidate_kind: "strict_pass", borderline: false, warnings, metrics, thresholds };
  }

  const unknownMetricCount = DATA_UNKNOWN_KEYS.filter((key) => metrics[key] === null).length;
  if (researchMode && unknownMetricCount > 0) {
    return {
      score,
      candidate_kind: "data_unknown_candidate",
      borderline: false,
      warnings,
      metrics,
      thresholds,
    };
  }

  return {
    score,
    candidate_kind: score >= MIN_BORDERLINE_SCORE ? "borderline_candidate" : "hard_reject",
    borderline: score >= MIN_BORDERLINE_SCORE,
    warnings,
    metrics,
    thresholds,
  };
}

function evaluationReason(site: CandidateSite, evaluation: GridCellDiagnostics): RejectionReason {
  if (site.in_protected_area === true || evaluation.metrics.protected_area_pct === 100) return "protected";
  if (site.in_flood_zone === true) return "flood";
  if (
    evaluation.metrics.mean_slope_percent !== null &&
    evaluation.metrics.mean_slope_percent > MAX_HARD_REJECT_SLOPE_PERCENT
  ) {
    return "high_slope";
  }
  if (
    evaluation.metrics.open_land_pct !== null &&
    evaluation.metrics.open_land_pct < MIN_HARD_REJECT_OPEN_LAND_PCT
  ) {
    return "low_open_land";
  }
  if (
    evaluation.metrics.ghi_kwh_m2_day !== null &&
    evaluation.metrics.ghi_kwh_m2_day < MIN_HARD_REJECT_GHI
  ) {
    return "low_solar";
  }
  if (
    evaluation.metrics.mean_slope_percent !== null &&
    evaluation.metrics.mean_slope_percent > STRICT_FILTERS.max_slope_percent
  ) {
    return "high_slope";
  }
  if (
    evaluation.metrics.open_land_pct !== null &&
    evaluation.metrics.open_land_pct < STRICT_FILTERS.min_open_land_score
  ) {
    return "low_open_land";
  }
  if (!STRICT_FILTERS.acceptable_land_cost.includes(site.estimated_land_cost_band)) {
    return "expensive_land";
  }
  if (!(STRICT_FILTERS.acceptable_infra as readonly string[]).includes(site.distance_to_infra_estimate)) {
    return "far_infra";
  }
  return "low_overall_score";
}

function computeGridScore(
  site: CandidateSite,
  metrics: GridCellMetrics,
  known: { solarKnown: boolean; slopeKnown: boolean; infraKnown: boolean; envKnown: boolean }
): number {
  const solarScore =
    metrics.ghi_kwh_m2_day !== null ? normalizeSolarGhi(metrics.ghi_kwh_m2_day) : UNKNOWN_METRIC_COMPONENT_SCORE;
  const openLandScore =
    metrics.open_land_pct !== null ? clamp(metrics.open_land_pct) : UNKNOWN_METRIC_COMPONENT_SCORE;
  const slopeScore =
    metrics.mean_slope_percent !== null
      ? normalizeSlope(metrics.mean_slope_percent)
      : UNKNOWN_METRIC_COMPONENT_SCORE;
  const gridScore = known.infraKnown ? infraBandScore(site.distance_to_infra_estimate) : UNKNOWN_METRIC_COMPONENT_SCORE;
  const environmentalScore =
    site.in_protected_area === true || site.in_flood_zone === true
      ? 0
      : known.envKnown
      ? 100
      : 60;
  const knownSignals = [
    known.solarKnown,
    known.slopeKnown,
    metrics.open_land_pct !== null,
    known.infraKnown,
    known.envKnown,
  ];
  const dataQualityScore = (knownSignals.filter((value) => value === true).length / 5) * 100;
  const moderateSlopePenalty =
    metrics.mean_slope_percent !== null &&
    metrics.mean_slope_percent >= MODERATE_SLOPE_MIN &&
    metrics.mean_slope_percent <= MODERATE_SLOPE_MAX
      ? Math.min(MAX_MODERATE_SLOPE_PENALTY, (metrics.mean_slope_percent - 5) * 2)
      : 0;
  const moderateOpenLandPenalty =
    metrics.open_land_pct !== null &&
    metrics.open_land_pct >= MODERATE_OPEN_LAND_MIN &&
    metrics.open_land_pct < MODERATE_OPEN_LAND_MAX
      ? Math.min(MAX_MODERATE_OPEN_LAND_PENALTY, (MODERATE_OPEN_LAND_MAX - metrics.open_land_pct) * 0.8)
      : 0;
  const farInfraPenalty =
    metrics.distance_to_transmission_km !== null && metrics.distance_to_transmission_km > MODERATE_INFRA_DISTANCE_KM
      ? Math.min(MAX_FAR_INFRA_PENALTY, (metrics.distance_to_transmission_km - MODERATE_INFRA_DISTANCE_KM) * 0.5)
      : site.distance_to_infra_estimate === "far"
      ? 10
      : 0;
  const missingDataPenalty = knownSignals.filter((value) => value === false).length * 4;

  return Math.round(
    clamp(
      solarScore * 0.25 +
        openLandScore * 0.25 +
        slopeScore * 0.2 +
        gridScore * 0.15 +
        environmentalScore * 0.1 +
        dataQualityScore * 0.05 -
        moderateSlopePenalty -
        moderateOpenLandPenalty -
        farInfraPenalty -
        missingDataPenalty
    ) * 10
  ) / 10;
}

function infraBandScore(band: CandidateSite["distance_to_infra_estimate"]): number {
  switch (band) {
    case "near":
      return 100;
    case "moderate":
      return 70;
    case "far":
      return 35;
    default:
      return UNKNOWN_METRIC_COMPONENT_SCORE;
  }
}

function toProvenanceMap(items: EnrichmentProvenance[] | undefined): Map<string, EnrichmentProvenance> {
  return new Map((items ?? []).map((item) => [item.source, item]));
}

function isKnown(items: Map<string, EnrichmentProvenance>, source: string): boolean {
  return items.get(source)?.status === "ok";
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
