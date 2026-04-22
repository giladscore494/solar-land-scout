import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CandidateSite, ExplainResponse, Language, StateMacro } from "@/types/domain";
import { localizeCandidateCautions, localizeCandidateReasons, localizeCandidateSummary, localizeRecommendedLabel, localizeStateName, localizeStateSummary } from "./i18n";

const MODEL = "gemini-1.5-flash-latest";
const TIMEOUT_MS = 8000;

function readApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        resolve(null);
      }
    );
  });
}

interface ModelJson {
  summary?: unknown;
  bullets?: unknown;
  risks?: unknown;
}

function parseExplainJson(raw: string) {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ModelJson;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) return null;
    return {
      summary,
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
        : [],
      risks: Array.isArray(parsed.risks)
        ? parsed.risks.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
        : [],
    };
  } catch {
    return null;
  }
}

async function runGemini(prompt: string) {
  const key = readApiKey();
  if (!key) return null;
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 650,
        responseMimeType: "application/json",
      },
    });
    const result = await withTimeout(
      (async () => {
        const response = await model.generateContent(prompt);
        return response.response.text();
      })(),
      TIMEOUT_MS
    );
    if (!result) return null;
    return parseExplainJson(result);
  } catch {
    return null;
  }
}

export async function explainState(state: StateMacro, language: Language): Promise<ExplainResponse> {
  const localeName = language === "he" ? "Hebrew" : "English";
  const prompt = `You are a utility-scale solar siting analyst. Respond in ${localeName} only.
Return STRICT JSON with keys summary, bullets, risks.
Gemini is an explanation layer only. Do not invent hard filter truth, parcel certainty, grid certainty, flood certainty, or exact terrain certainty.
Use ONLY the structured data below.
DATA: ${JSON.stringify({
    state_name: localizeStateName(state, language),
    state_code: state.state_code,
    macro_total_score: state.macro_total_score,
    recommended_label: localizeRecommendedLabel(state.recommended_label, language),
    solar: state.average_solar_potential_score,
    land_cost: state.land_cost_score,
    electricity_price: state.electricity_price_score,
    open_land: state.open_land_availability_score,
    development_friendliness: state.development_friendliness_score,
    summary_seed: localizeStateSummary(state, language),
  })}`;

  const llm = await runGemini(prompt);
  if (llm) {
    return {
      kind: "state",
      summary: llm.summary,
      bullets: llm.bullets,
      risks: llm.risks,
      from_llm: true,
    };
  }
  return {
    kind: "state",
    summary: `${localizeStateName(state, language)} ${language === "he" ? `מקבלת` : `scores`} ${state.macro_total_score.toFixed(1)}/100. ${localizeStateSummary(state, language)}`,
    bullets: language === "he"
      ? [
          `ציון סולאר: ${state.average_solar_potential_score}/100`,
          `ציון עלות קרקע: ${state.land_cost_score}/100`,
          `מחיר חשמל: ${state.electricity_price_score}/100`,
          `שטח פתוח: ${state.open_land_availability_score}/100`,
          `ידידותיות לפיתוח: ${state.development_friendliness_score}/100`,
        ]
      : [
          `Solar potential: ${state.average_solar_potential_score}/100`,
          `Land cost: ${state.land_cost_score}/100`,
          `Electricity price: ${state.electricity_price_score}/100`,
          `Open land: ${state.open_land_availability_score}/100`,
          `Development friendliness: ${state.development_friendliness_score}/100`,
        ],
    risks: language === "he"
      ? [
          "אימות תשתית וחיבור לרשת עדיין חסר.",
          "אימות סביבתי ומסלולי היתרים עדיין נדרש.",
          "הערכת הקרקע עדיין אינה ברמת חלקה בודדת.",
        ]
      : [
          "Interconnection reality still needs project-level verification.",
          "Environmental and county permitting constraints still need review.",
          "Land cost remains an estimated macro signal, not parcel truth.",
        ],
    from_llm: false,
  };
}

export async function explainSite(site: CandidateSite, language: Language): Promise<ExplainResponse> {
  const storedSummary = localizeCandidateSummary(site, language).trim();
  if (storedSummary) {
    return {
      kind: "site",
      summary: storedSummary,
      bullets: localizeCandidateReasons(site, language),
      risks: localizeCandidateCautions(site, language),
      from_llm: true,
    };
  }

  const localeName = language === "he" ? "Hebrew" : "English";
  const prompt = `You are a utility-scale solar siting analyst. Respond in ${localeName} only.
Return STRICT JSON with keys summary, bullets, risks.
Do not invent exact land pricing, flood truth, protected-area truth, or exact transmission distance.
Only explain the structured findings below.
DATA: ${JSON.stringify({
    title: site.title,
    state_name: language === "he" ? site.state_name_he : site.state_name_en,
    lat: site.lat,
    lng: site.lng,
    solar_resource_value: site.solar_resource_value,
    estimated_land_cost_band: site.estimated_land_cost_band,
    distance_to_infra_estimate: site.distance_to_infra_estimate,
    slope_estimate: site.slope_estimate,
    open_land_score: site.open_land_score,
    passes_strict_filters: site.passes_strict_filters,
    overall_site_score: site.overall_site_score,
    qualification_reasons: localizeCandidateReasons(site, language),
    caution_notes: localizeCandidateCautions(site, language),
  })}`;
  const llm = await runGemini(prompt);
  if (llm) {
    return {
      kind: "site",
      summary: llm.summary,
      bullets: llm.bullets.length ? llm.bullets : localizeCandidateReasons(site, language),
      risks: llm.risks.length ? llm.risks : localizeCandidateCautions(site, language),
      from_llm: true,
    };
  }
  return {
    kind: "site",
    summary:
      language === "he"
        ? `${site.title} מקבל ${site.overall_site_score.toFixed(0)}/100 לפי הכללים המחמירים הנוכחיים. משאב סולארי, שיפוע מוערך, עלות קרקע וקרבה לתשתית תומכים בבחינה נוספת — אך עדיין נדרש אימות שטח.`
        : `${site.title} scores ${site.overall_site_score.toFixed(0)}/100 under the current strict rules. Solar resource, estimated slope, land-cost band, and infrastructure proximity support further screening, but field verification still matters.`,
    bullets: localizeCandidateReasons(site, language),
    risks: localizeCandidateCautions(site, language),
    from_llm: false,
  };
}

export async function generateCandidateStoredSummaries(site: CandidateSite) {
  return {
    gemini_summary_en: (await generateStoredSummary(site, "en")) ?? buildStoredSummaryFallback(site, "en"),
    gemini_summary_he: (await generateStoredSummary(site, "he")) ?? buildStoredSummaryFallback(site, "he"),
  };
}

async function generateStoredSummary(site: CandidateSite, language: Language) {
  const prompt = `Respond in ${language === "he" ? "Hebrew" : "English"} only.
Return STRICT JSON with keys summary, bullets, risks.
Provide only a concise 2-3 sentence explanation for a current-stage solar candidate site using the structured data below. Do not invent exact truths beyond the data.
DATA: ${JSON.stringify({
    title: site.title,
    state_name: language === "he" ? site.state_name_he : site.state_name_en,
    solar_resource_value: site.solar_resource_value,
    estimated_land_cost_band: site.estimated_land_cost_band,
    distance_to_infra_estimate: site.distance_to_infra_estimate,
    slope_estimate: site.slope_estimate,
    open_land_score: site.open_land_score,
    overall_site_score: site.overall_site_score,
    qualification_reasons: localizeCandidateReasons(site, language),
    caution_notes: localizeCandidateCautions(site, language),
  })}`;
  const response = await runGemini(prompt);
  return response?.summary ?? null;
}

function buildStoredSummaryFallback(site: CandidateSite, language: Language) {
  return language === "he"
    ? `${site.title} נראה אטרקטיבי בשלב זה בזכות ${site.solar_resource_value.toFixed(1)} kWh/m²/day, שיפוע מוערך של ${site.slope_estimate.toFixed(1)}% וציון שטח פתוח של ${site.open_land_score}/100. עדיין מדובר בניתוח סינון מוקדם ולא באמת קרקע ברמת חלקה.`
    : `${site.title} looks attractive at this stage because it combines ${site.solar_resource_value.toFixed(1)} kWh/m²/day, an estimated ${site.slope_estimate.toFixed(1)}% slope, and an open-land score of ${site.open_land_score}/100. This is still an early screening result, not parcel-grade truth.`;
}
