import type { CandidateSite, StateMacro } from "@/types/domain";
import { FEASIBILITY_THRESHOLDS, FEASIBILITY_WEIGHTS } from "./scoring-config";
import { clamp, computeSiteScore, infraScoreFromBand, landCostScoreFromBand, normalizeSlope, normalizeSolarGhi } from "./scoring";
import { fetchSolarResource } from "./nrel";
import { getSlopeEstimate } from "./usgs";
import { checkProtectedArea } from "./padus";
import { checkFloodRisk } from "./fema";
import { checkWetlands } from "./wetlands";
import { hashString } from "./util";
import { completeWeakFieldsWithGemini } from "./gemini";

function stateAnchor(stateCode: string): { lat: number; lng: number } {
  const h = hashString(stateCode);
  const lat = 26 + (h % 2200) / 100;
  const lng = -124 + ((h >> 5) % 5700) / 100;
  return { lat: Math.min(49, lat), lng: Math.min(-66, lng) };
}

function deterministicOffsets() {
  return [
    [0, 0],
    [0.35, 0.35],
    [-0.3, 0.28],
    [0.45, -0.25],
    [-0.4, -0.3],
    [0.18, -0.48],
    [-0.52, 0.15],
    [0.58, 0.08],
  ];
}

function bandFromHash(seed: number): CandidateSite["estimated_land_cost_band"] {
  const v = seed % 100;
  if (v < 30) return "low";
  if (v < 65) return "moderate";
  if (v < 85) return "elevated";
  return "high";
}

function infraFromHash(seed: number): CandidateSite["distance_to_infra_estimate"] {
  const v = seed % 100;
  if (v < 40) return "near";
  if (v < 80) return "moderate";
  return "far";
}

export async function runStateAnalysis(state: StateMacro, language: "en" | "he" = "en") {
  const anchor = stateAnchor(state.state_code);
  const candidates: CandidateSite[] = [];

  for (const [idx, [dLat, dLng]] of deterministicOffsets().entries()) {
    const lat = Number((anchor.lat + dLat).toFixed(5));
    const lng = Number((anchor.lng + dLng).toFixed(5));
    const seed = hashString(`${state.state_code}:${idx}`);

    const [nrel, slope, padus, flood, wetlands] = await Promise.all([
      fetchSolarResource(lat, lng),
      getSlopeEstimate(lat, lng),
      checkProtectedArea(lat, lng),
      checkFloodRisk(lat, lng),
      checkWetlands(lat, lng),
    ]);

    const solar = nrel.avg_ghi ?? Number((4.6 + (seed % 20) / 10).toFixed(2));
    const slopePercent = slope.slope_percent ?? Number(((seed % 55) / 10).toFixed(2));
    const openLand = 45 + (seed % 56);

    const landBand = bandFromHash(seed);
    const infraBand = infraFromHash(seed >> 1);

    const baseScore = computeSiteScore({
      solar_resource_value: solar,
      slope_estimate: slopePercent,
      open_land_score: openLand,
      estimated_land_cost_band: landBand,
      distance_to_infra_estimate: infraBand,
    });

    const feasibility = clamp(
      normalizeSolarGhi(solar) * FEASIBILITY_WEIGHTS.solar +
        normalizeSlope(slopePercent) * FEASIBILITY_WEIGHTS.slope +
        openLand * FEASIBILITY_WEIGHTS.openLand +
        landCostScoreFromBand(landBand) * FEASIBILITY_WEIGHTS.landCost +
        infraScoreFromBand(infraBand) * FEASIBILITY_WEIGHTS.infra -
        flood.risk_score_0_100 * FEASIBILITY_WEIGHTS.floodPenalty -
        wetlands.impact_score_0_100 * FEASIBILITY_WEIGHTS.wetlandsPenalty
    );

    const riskBreakdown = {
      protected_area: padus.intersects,
      flood_risk_score: flood.risk_score_0_100,
      wetlands_impact_score: wetlands.impact_score_0_100,
      terrain_source: slope.source,
      flood_source: flood.source,
      wetlands_source: wetlands.source,
      protected_source: padus.source,
    };

    const strictPass =
      slopePercent <= FEASIBILITY_THRESHOLDS.max_slope_percent &&
      openLand >= 55 &&
      !padus.intersects &&
      flood.risk_score_0_100 < FEASIBILITY_THRESHOLDS.max_flood_risk_score &&
      wetlands.impact_score_0_100 < FEASIBILITY_THRESHOLDS.max_wetlands_impact_score &&
      feasibility >= FEASIBILITY_THRESHOLDS.min_feasibility_score;

    const qualification_reasons = [
      `Solar resource ~${solar.toFixed(2)} GHI`,
      `Slope estimate ${slopePercent.toFixed(1)}%`,
      `Open-land suitability ${openLand}/100`,
      `Infrastructure proximity ${infraBand}`,
    ];

    const caution_notes = [
      padus.intersects ? "Protected area overlap detected." : "No protected overlap from current screening.",
      flood.high_risk ? "Flood exposure is elevated." : "Flood signal currently limited.",
      wetlands.intersects ? "Wetland interaction risk present." : "Wetland signal currently limited.",
    ];

    const site: CandidateSite = {
      id: `${state.state_code}-run-${Date.now()}-${idx}`,
      run_id: null,
      state_code: state.state_code,
      state_name: state.state_name,
      title: `${state.state_name} Feasibility Candidate ${idx + 1}`,
      lat,
      lng,
      solar_resource_value: solar,
      estimated_land_cost_band: landBand,
      distance_to_infra_estimate: infraBand,
      slope_estimate: slopePercent,
      open_land_score: openLand,
      passes_strict_filters: strictPass,
      qualification_reasons,
      caution_notes,
      qualification_reasons_json: qualification_reasons,
      caution_notes_json: caution_notes,
      gemini_summary_seed: "",
      overall_site_score: Number(baseScore.toFixed(1)),
      feasibility_score: Number(feasibility.toFixed(1)),
      risk_breakdown: riskBreakdown,
      still_to_verify_notes: [
        "Parcel-level boundary and title review",
        "Interconnection queue and hosting capacity",
        "County/state permitting pathway",
        "Wetland and flood delineation survey",
        "Site access and geotech constraints",
      ],
    };

    const gemini = await completeWeakFieldsWithGemini({
      state_code: state.state_code,
      state_name: state.state_name,
      lat,
      lng,
      current_land_cost_band: landBand,
      current_grid_band: infraBand,
      language,
    });

    site.gemini_debug_json = gemini as unknown as Record<string, unknown>;
    site.gemini_summary_en = gemini.state_or_site_summary.summary_short ?? null;
    site.gemini_summary_seed = gemini.state_or_site_summary.summary_short ?? "Deterministic feasibility screening result.";
    site.land_cost_completion_source = gemini.weak_field_completion.land_cost_completion.source_basis;
    site.grid_completion_source = gemini.weak_field_completion.grid_proximity_completion.source_basis;
    site.land_cost_completion_confidence = gemini.weak_field_completion.land_cost_completion.confidence_0_100;
    site.grid_completion_confidence = gemini.weak_field_completion.grid_proximity_completion.confidence_0_100;

    candidates.push(site);
  }

  const passing = candidates.filter((c) => c.passes_strict_filters);

  // Build a run-level debug summary that is honest about what was attempted
  // and what was actually used across ALL generated candidates.
  const debugs = candidates
    .map((c) => c.gemini_debug_json as Record<string, unknown> | undefined)
    .filter((d): d is Record<string, unknown> => !!d);

  const groundingAttempted = debugs.filter((d) => d.attempted_grounding === true).length;
  const groundingUsed = debugs.filter((d) => d.grounding_used === true).length;
  const mapsAttempted = debugs.filter((d) => d.attempted_maps_context === true).length;
  const mapsUsed = debugs.filter((d) => d.maps_context_used === true).length;

  const runDebug = {
    state_code: state.state_code,
    state_name: state.state_name,
    language,
    total_generated: candidates.length,
    total_passing_strict: passing.length,
    gemini_model: debugs[0]?.model ?? null,
    gemini_timeout_ms: debugs[0]?.timeout_ms ?? null,
    grounding_attempts: groundingAttempted,
    grounding_uses: groundingUsed,
    maps_context_attempts: mapsAttempted,
    maps_context_uses: mapsUsed,
    per_site_summary: candidates.map((c) => ({
      site_id: c.id,
      title: c.title,
      passes_strict_filters: c.passes_strict_filters,
      feasibility_score: c.feasibility_score,
      attempted_grounding:
        (c.gemini_debug_json as Record<string, unknown> | null | undefined)
          ?.attempted_grounding ?? null,
      grounding_used:
        (c.gemini_debug_json as Record<string, unknown> | null | undefined)
          ?.grounding_used ?? null,
      grounding_failure_reason:
        (c.gemini_debug_json as Record<string, unknown> | null | undefined)
          ?.grounding_failure_reason ?? null,
    })),
  };

  return {
    state_code: state.state_code,
    total_generated: candidates.length,
    candidates,
    passing,
    run_debug: runDebug,
  };
}
