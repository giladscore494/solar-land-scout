/**
 * Gemini integration — server-side only.
 *
 * Gemini is used as an explanation & narrative layer on top of already-computed
 * structured data. It NEVER produces coordinates, filter truth, geometry, or
 * hard pass/fail. It only rephrases / summarizes what the deterministic engine
 * has already decided.
 *
 * The contract:
 *  - prompts are tightly bounded to the input payload
 *  - timeout + try/catch → callers always get a usable result (local fallback)
 *  - model is asked for strict JSON; output is parsed and validated
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  CandidateSite,
  ExplainResponse,
  StateMacro,
} from "@/types/domain";

const MODEL = "gemini-1.5-flash-latest";
const TIMEOUT_MS = 8000;

function readApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

/** Withdraw-friendly promise race: resolves with fallback if Gemini is slow. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
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

function validateModelJson(
  raw: string
): { summary: string; bullets: string[]; risks: string[] } | null {
  try {
    // Models sometimes wrap JSON in ```json fences — strip them defensively.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    const parsed: ModelJson = JSON.parse(cleaned);
    const summary =
      typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets.filter((b): b is string => typeof b === "string").slice(0, 6)
      : [];
    const risks = Array.isArray(parsed.risks)
      ? parsed.risks.filter((b): b is string => typeof b === "string").slice(0, 6)
      : [];
    if (!summary) return null;
    return { summary, bullets, risks };
  } catch {
    return null;
  }
}

async function runGemini(prompt: string): Promise<ReturnType<typeof validateModelJson>> {
  const key = readApiKey();
  if (!key) return null;
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 600,
        responseMimeType: "application/json",
      },
    });
    const result = await withTimeout(
      (async () => {
        const r = await model.generateContent(prompt);
        return r.response.text();
      })(),
      TIMEOUT_MS
    );
    if (!result) return null;
    return validateModelJson(result);
  } catch {
    return null;
  }
}

/* ----------------------------- State explanation ---------------------------- */

export async function explainState(state: StateMacro): Promise<ExplainResponse> {
  const prompt = `You are a solar-farm siting analyst. Using ONLY the structured data below, write a concise premium-analyst explanation of why this U.S. state is (or isn't) attractive for utility-scale solar development.

Return STRICT JSON with keys: "summary" (2-3 sentences, no marketing fluff), "bullets" (3-5 crisp reasons, each <=16 words), "risks" (2-4 things that still need verification).

Do NOT invent numbers, coordinates, or land prices. Only use the fields provided.

DATA:
${JSON.stringify(
  {
    state_name: state.state_name,
    state_code: state.state_code,
    macro_total_score: state.macro_total_score,
    recommended_label: state.recommended_label,
    solar: state.average_solar_potential_score,
    land_cost: state.land_cost_score,
    electricity_price: state.electricity_price_score,
    open_land: state.open_land_availability_score,
    development_friendliness: state.development_friendliness_score,
    seed_summary: state.macro_summary_seed,
  },
  null,
  2
)}`;

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
  return stateFallback(state);
}

function stateFallback(s: StateMacro): ExplainResponse {
  return {
    kind: "state",
    summary: `${s.state_name} scores ${s.macro_total_score}/100 (${s.recommended_label}). ${s.macro_summary_seed}`,
    bullets: [
      `Solar potential score: ${s.average_solar_potential_score}/100`,
      `Land cost score: ${s.land_cost_score}/100`,
      `Electricity price relevance: ${s.electricity_price_score}/100`,
      `Open-land availability: ${s.open_land_availability_score}/100`,
      `Development friendliness: ${s.development_friendliness_score}/100`,
    ],
    risks: [
      "Live parcel-level land data not yet integrated.",
      "Interconnection queue status varies by utility and is not reflected here.",
      "Permitting timelines depend on county-level policy.",
    ],
    from_llm: false,
  };
}

/* ----------------------------- Site explanation ----------------------------- */

export async function explainSite(site: CandidateSite): Promise<ExplainResponse> {
  const prompt = `You are a solar-farm siting analyst. The structured data below describes a candidate point that has ALREADY been pre-filtered by a deterministic rule engine. Explain in analyst-grade language why it currently qualifies under strict v1 rules and what still needs verification.

Return STRICT JSON with keys: "summary" (2-3 sentences), "bullets" (qualification reasons restated crisply, <=16 words each), "risks" (site-specific items to verify — interconnection, environmental, permitting, slope/parcel truth, etc.).

Do NOT invent coordinates or precise land prices. Only use the provided fields.

DATA:
${JSON.stringify(
  {
    title: site.title,
    state: site.state_name,
    lat: site.lat,
    lng: site.lng,
    solar_resource_ghi: site.solar_resource_value,
    slope_estimate_pct: site.slope_estimate,
    open_land_score: site.open_land_score,
    land_cost_band: site.estimated_land_cost_band,
    infra_proximity: site.distance_to_infra_estimate,
    overall_site_score: site.overall_site_score,
    passes_strict_filters: site.passes_strict_filters,
    qualification_reasons: site.qualification_reasons,
    caution_notes: site.caution_notes,
    seed_summary: site.gemini_summary_seed,
  },
  null,
  2
)}`;

  const llm = await runGemini(prompt);
  if (llm) {
    return {
      kind: "site",
      summary: llm.summary,
      bullets: llm.bullets.length ? llm.bullets : site.qualification_reasons,
      risks: llm.risks.length ? llm.risks : site.caution_notes,
      from_llm: true,
    };
  }
  return siteFallback(site);
}

function siteFallback(s: CandidateSite): ExplainResponse {
  return {
    kind: "site",
    summary: `${s.title} scores ${s.overall_site_score}/100 under current strict rules. ${s.gemini_summary_seed}`,
    bullets: s.qualification_reasons,
    risks: s.caution_notes,
    from_llm: false,
  };
}
