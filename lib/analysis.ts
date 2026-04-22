import type { CandidateSite, Language, StateMacro } from "@/types/domain";
import type { DataRepository } from "./repository";
import { ANALYSIS_CONFIG, STRICT_FILTERS } from "./scoring-config";
import { clamp, computeSiteScore } from "./scoring";
import { passesStrictFilters } from "./filters";
import { fetchSolarResource } from "./nrel";
import { centroidOfFeature, getFeatureBounds, getStateFeature, pointInsideFeature } from "./us-state-geometry";
import { generateCandidateStoredSummaries } from "./gemini";

export async function runStateAnalysis(
  repository: DataRepository,
  stateCode: string,
  language: Language
) {
  const dbAvailable = await repository.isDatabaseAvailable();
  if (!dbAvailable) {
    return {
      run: null,
      sites: [],
      generated_at: new Date().toISOString(),
      db_available: false,
      error: "db_unavailable",
    };
  }

  const state = await repository.getState(stateCode);
  if (!state) {
    return {
      run: null,
      sites: [],
      generated_at: new Date().toISOString(),
      db_available: true,
      error: "state_not_found",
    };
  }

  const run = await repository.createAnalysisRun({ stateCode: state.state_code, language });
  if (!run) {
    return {
      run: null,
      sites: [],
      generated_at: new Date().toISOString(),
      db_available: true,
      error: "run_create_failed",
    };
  }

  try {
    const generatedSites = await generateCandidateSites(state, run.id);
    await repository.replaceRunSites(run.id, state.state_code, generatedSites);

    const summaryUpdates = await Promise.all(
      generatedSites.map(async (site) => ({ id: site.id, ...(await generateCandidateStoredSummaries(site)) }))
    );
    await repository.updateSiteSummaries(summaryUpdates);

    const finalSites = generatedSites.map((site) => {
      const summary = summaryUpdates.find((entry) => entry.id === site.id);
      return summary ? { ...site, ...summary } : site;
    });

    const notes = buildRunNotes(finalSites.length, language);
    const completedRun = await repository.updateAnalysisRun(run.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      notes,
    });

    return {
      run: completedRun,
      sites: finalSites,
      generated_at: new Date().toISOString(),
      db_available: true,
    };
  } catch (error) {
    await repository.updateAnalysisRun(run.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      notes: language === "he" ? "הניתוח נכשל לפני השלמה." : "Analysis failed before completion.",
    });
    return {
      run: await repository.getLatestAnalysisRun(state.state_code),
      sites: [],
      generated_at: new Date().toISOString(),
      db_available: true,
      error: error instanceof Error ? error.message : "analysis_failed",
    };
  }
}

async function generateCandidateSites(state: StateMacro, runId: number): Promise<CandidateSite[]> {
  const feature = getStateFeature(state.state_code);
  const bounds = feature ? getFeatureBounds(feature) : null;
  if (!feature || !bounds) return [];

  const centroid = centroidOfFeature(feature) ?? [
    (bounds.minLng + bounds.maxLng) / 2,
    (bounds.minLat + bounds.maxLat) / 2,
  ];

  const candidateSeeds: CandidateSite[] = [];
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;

  for (let row = 0; row < ANALYSIS_CONFIG.gridRows; row += 1) {
    for (let col = 0; col < ANALYSIS_CONFIG.gridColumns; col += 1) {
      const offsetA = stableUnit(state.state_code, row, col, "lng");
      const offsetB = stableUnit(state.state_code, row, col, "lat");
      const lng = bounds.minLng + ((col + 0.5 + (offsetA - 0.5) * 0.7) / ANALYSIS_CONFIG.gridColumns) * lngSpan;
      const lat = bounds.minLat + ((row + 0.5 + (offsetB - 0.5) * 0.7) / ANALYSIS_CONFIG.gridRows) * latSpan;
      if (!pointInsideFeature([lng, lat], feature)) continue;
      candidateSeeds.push(
        buildCandidateSeed(state, runId, row, col, lat, lng, centroid[1] ?? lat, centroid[0] ?? lng)
      );
    }
  }

  const shortlisted = candidateSeeds
    .sort((a, b) => b.overall_site_score - a.overall_site_score)
    .slice(0, ANALYSIS_CONFIG.maxCandidateSeeds);

  await Promise.all(
    shortlisted.slice(0, ANALYSIS_CONFIG.maxNrelLookups).map(async (site) => {
      const solar = await fetchSolarResource(site.lat, site.lng);
      if (solar.avg_ghi != null) {
        site.solar_resource_value = clamp(solar.avg_ghi, 3.5, 7.2);
        site.overall_site_score = computeSiteScore(site);
        site.passes_strict_filters = passesStrictFilters(site);
        applyNarrative(site);
      }
    })
  );

  return shortlisted
    .filter((site) => site.passes_strict_filters)
    .sort((a, b) => b.overall_site_score - a.overall_site_score)
    .slice(0, ANALYSIS_CONFIG.maxPersistedSites);
}

function buildCandidateSeed(
  state: StateMacro,
  runId: number,
  row: number,
  col: number,
  lat: number,
  lng: number,
  centroidLat: number,
  centroidLng: number
): CandidateSite {
  const southBias = clamp((37 - lat) * 5, -12, 18);
  const westBias = clamp((-95 - lng) * 1.2, -12, 16);
  const distanceBias = Math.abs(lat - centroidLat) * 2.2 + Math.abs(lng - centroidLng) * 0.7;
  const solarResourceValue = clamp(
    4.1 + state.average_solar_potential_score / 45 + southBias / 22 + westBias / 36 - distanceBias / 60,
    3.7,
    7.1
  );
  const slopeEstimate = clamp(
    0.7 + (100 - state.development_friendliness_score) / 28 + stableUnit(state.state_code, row, col, "slope") * 4.6,
    0.5,
    8.4
  );
  const openLandScore = Math.round(
    clamp(
      state.open_land_availability_score + westBias / 2 - distanceBias / 3 + stableSigned(state.state_code, row, col, "open") * 12,
      36,
      98
    )
  );

  const landCostBand = bandFromValue(
    state.land_cost_score + stableSigned(state.state_code, row, col, "land") * 24 - distanceBias * 0.8
  );
  const infra = infraFromValue(
    state.development_friendliness_score + state.electricity_price_score / 3 - distanceBias * 1.4 + stableSigned(state.state_code, row, col, "infra") * 28
  );

  const title = buildTitle(state.state_name_en, lat, lng, centroidLat, centroidLng);

  const site: CandidateSite = {
    id: `${state.state_code.toLowerCase()}-run-${runId}-${row + 1}-${col + 1}`,
    run_id: runId,
    state_code: state.state_code,
    state_name_en: state.state_name_en,
    state_name_he: state.state_name_he,
    lat: round(lat, 4),
    lng: round(lng, 4),
    title,
    solar_resource_value: round(solarResourceValue, 1),
    estimated_land_cost_band: landCostBand,
    distance_to_infra_estimate: infra,
    slope_estimate: round(slopeEstimate, 1),
    open_land_score: openLandScore,
    passes_strict_filters: false,
    qualification_reasons_en: [],
    qualification_reasons_he: [],
    caution_notes_en: [],
    caution_notes_he: [],
    gemini_summary_en: "",
    gemini_summary_he: "",
    overall_site_score: 0,
    data_source: "database",
  };
  site.overall_site_score = computeSiteScore(site);
  site.passes_strict_filters = passesStrictFilters(site);
  applyNarrative(site);
  return site;
}

function applyNarrative(site: CandidateSite) {
  site.qualification_reasons_en = [
    `Solar estimate clears the ${STRICT_FILTERS.min_solar_resource.toFixed(1)} GHI screening floor.`,
    `Estimated slope of ${site.slope_estimate.toFixed(1)}% supports early utility-scale layout review.`,
    `Open-land score of ${site.open_land_score}/100 supports current-stage screening.`,
    `${site.distance_to_infra_estimate === "near" ? "Near" : site.distance_to_infra_estimate === "moderate" ? "Moderate" : "Estimated far"} infrastructure proximity keeps the opportunity reviewable.`,
  ];
  site.qualification_reasons_he = [
    `הערכת הסולאר עוברת את סף ה-GHI של ${STRICT_FILTERS.min_solar_resource.toFixed(1)}.`,
    `שיפוע מוערך של ${site.slope_estimate.toFixed(1)}% מתאים לבדיקה ראשונית של פריסת פרויקט.`,
    `ציון שטח פתוח ${site.open_land_score}/100 תומך בסינון בשלב הנוכחי.`,
    `${site.distance_to_infra_estimate === "near" ? "קרבת תשתית טובה" : site.distance_to_infra_estimate === "moderate" ? "קרבת תשתית בינונית" : "קרבת תשתית רחוקה"} עדיין מאפשרת בחינה ראשונית.`,
  ];
  site.caution_notes_en = [
    "Infrastructure proximity is still estimated and not queue-verified.",
    "Environmental, parcel, and county permitting constraints still need review.",
    "Slope remains estimated until higher-resolution terrain data is integrated.",
  ];
  site.caution_notes_he = [
    "קרבת התשתית עדיין מוערכת ואינה מאומתת מול תור חיבור.",
    "נדרש עדיין אימות סביבתי, קנייני ומסלולי היתרים מחוזיים.",
    "השיפוע עדיין מוערך עד לשילוב נתוני טופוגרפיה מדויקים יותר.",
  ];
}

function buildRunNotes(siteCount: number, language: Language) {
  return language === "he"
    ? siteCount > 0
      ? `הניתוח הושלם ונשמרו ${siteCount} אתרי מועמדים שעברו את הסף.`
      : "הניתוח הושלם אך לא נמצאו אתרי מועמדים שעברו את המסננים המחמירים."
    : siteCount > 0
      ? `Analysis completed and saved ${siteCount} candidate sites that passed strict filters.`
      : "Analysis completed but no candidate sites passed the strict filters.";
}

function stableUnit(...parts: Array<string | number>) {
  const input = parts.join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function stableSigned(...parts: Array<string | number>) {
  return stableUnit(...parts) * 2 - 1;
}

function bandFromValue(value: number): CandidateSite["estimated_land_cost_band"] {
  if (value >= 80) return "low";
  if (value >= 62) return "moderate";
  if (value >= 44) return "elevated";
  return "high";
}

function infraFromValue(value: number): CandidateSite["distance_to_infra_estimate"] {
  if (value >= 70) return "near";
  if (value >= 48) return "moderate";
  return "far";
}

function buildTitle(stateName: string, lat: number, lng: number, centroidLat: number, centroidLng: number) {
  const northSouth = lat >= centroidLat ? "Northern" : "Southern";
  const eastWest = lng >= centroidLng ? "Eastern" : "Western";
  const descriptor = lat >= centroidLat ? (lng >= centroidLng ? "Corridor" : "Plateau") : lng >= centroidLng ? "Basin" : "Flats";
  return `${stateName} ${northSouth}-${eastWest} ${descriptor}`;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
