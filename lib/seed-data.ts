import statesSeed from "@/data/us_states_macro.json";
import sitesSeed from "@/data/candidate_sites.json";
import type { CandidateSite, StateMacro } from "@/types/domain";
import { computeSiteScore, hydrateStateMacro } from "./scoring";
import { passesStrictFilters } from "./filters";
import { hebrewStateNameFor } from "./state-translations";

interface RawStateSeed {
  state_code: string;
  state_name: string;
  average_solar_potential_score: number;
  electricity_price_score: number;
  land_cost_score: number;
  open_land_availability_score: number;
  development_friendliness_score: number;
  macro_summary_seed: string;
}

interface RawSiteSeed {
  id: string;
  state_code: string;
  state_name: string;
  lat: number;
  lng: number;
  title: string;
  solar_resource_value: number;
  estimated_land_cost_band: CandidateSite["estimated_land_cost_band"];
  distance_to_infra_estimate: CandidateSite["distance_to_infra_estimate"];
  slope_estimate: number;
  open_land_score: number;
  qualification_reasons: string[];
  caution_notes: string[];
  gemini_summary_seed: string;
}

export function loadSeedStates(): StateMacro[] {
  return (statesSeed as RawStateSeed[])
    .map((row) =>
      hydrateStateMacro({
        state_code: row.state_code,
        state_name_en: row.state_name,
        state_name_he: hebrewStateNameFor(row.state_code, row.state_name),
        average_solar_potential_score: row.average_solar_potential_score,
        electricity_price_score: row.electricity_price_score,
        land_cost_score: row.land_cost_score,
        open_land_availability_score: row.open_land_availability_score,
        development_friendliness_score: row.development_friendliness_score,
        macro_total_score: 0,
        macro_summary_en: row.macro_summary_seed,
        macro_summary_he: buildStateSummaryHe(
          hebrewStateNameFor(row.state_code, row.state_name),
          row.average_solar_potential_score,
          row.land_cost_score,
          row.open_land_availability_score,
          row.development_friendliness_score
        ),
        recommended_label: "Tier 4 — Marginal",
      })
    )
    .sort((a, b) => b.macro_total_score - a.macro_total_score);
}

export function loadSeedSites(): CandidateSite[] {
  return (sitesSeed as RawSiteSeed[])
    .map((row) => {
      const site: CandidateSite = {
        id: row.id,
        run_id: null,
        state_code: row.state_code,
        state_name_en: row.state_name,
        state_name_he: hebrewStateNameFor(row.state_code, row.state_name),
        lat: row.lat,
        lng: row.lng,
        title: row.title,
        solar_resource_value: row.solar_resource_value,
        estimated_land_cost_band: row.estimated_land_cost_band,
        distance_to_infra_estimate: row.distance_to_infra_estimate,
        slope_estimate: row.slope_estimate,
        open_land_score: row.open_land_score,
        passes_strict_filters: false,
        qualification_reasons_en: row.qualification_reasons,
        qualification_reasons_he: buildSeedReasonsHe(row),
        caution_notes_en: row.caution_notes,
        caution_notes_he: buildSeedCautionsHe(row),
        gemini_summary_en: row.gemini_summary_seed,
        gemini_summary_he: buildSiteSummaryHe(row.state_name, row),
        overall_site_score: 0,
        data_source: "seed",
      };
      const overall_site_score = computeSiteScore(site);
      const withScore: CandidateSite = { ...site, overall_site_score };
      return {
        ...withScore,
        passes_strict_filters: passesStrictFilters(withScore),
      };
    })
    .sort((a, b) => b.overall_site_score - a.overall_site_score);
}

function buildStateSummaryHe(
  stateNameHe: string,
  solar: number,
  land: number,
  openLand: number,
  development: number
) {
  return `${stateNameHe} מציגה בסיס אטרקטיבי לניתוח סולארי עם ציון סולאר ${solar}/100, התאמת קרקע ${land}/100 וזמינות שטחים פתוחים ${openLand}/100. זה עדיין שלב אנליטי מוקדם, ולכן נדרש אימות ברמת תשתית, סביבתיות והיתרים גם כאשר נוחות הפיתוח עומדת על ${development}/100.`;
}

function buildSiteSummaryHe(stateNameEn: string, site: RawSiteSeed) {
  return `האתר ${site.title} ב-${stateNameEn} נראה מעניין בשלב זה בזכות משאב סולארי של ${site.solar_resource_value.toFixed(1)} kWh/m²/day, שיפוע מוערך של ${site.slope_estimate.toFixed(1)}% וציון שטח פתוח של ${site.open_land_score}/100. עדיין יש לאמת אמת קרקע, חיבור לרשת וסיכוני היתרים לפני קידום.`;
}

function buildSeedReasonsHe(site: RawSiteSeed): string[] {
  return [
    `משאב סולארי מוערך של ${site.solar_resource_value.toFixed(1)} kWh/m²/day.` ,
    `שיפוע מוערך של ${site.slope_estimate.toFixed(1)}% מתאים לפריסה ראשונית.`,
    `ציון שטח פתוח ${site.open_land_score}/100 תומך בבחינה נוספת.`,
    `רמת עלות הקרקע ${site.estimated_land_cost_band} וקרבת התשתית ${site.distance_to_infra_estimate} תומכות בסינון הראשוני.`
  ];
}

function buildSeedCautionsHe(site: RawSiteSeed): string[] {
  return [
    `נדרשת בדיקת אמת לרמת תשתית ${site.distance_to_infra_estimate}.`,
    `נדרש אימות סביבתי, קנייני והיתרי עבור ${site.title}.`,
    `הניתוח הנוכחי אינו מחליף בדיקת שטח, טופוגרפיה וסטטוס תור חיבור.`
  ];
}
