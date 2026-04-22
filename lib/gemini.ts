import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CandidateSite, ExplainResponse, StateMacro } from "@/types/domain";

const MODEL = "gemini-1.5-flash-latest";
const TIMEOUT_MS = 9000;

function readApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

interface GeminiCompletion {
  query_area: string;
  attempted_grounding: boolean;
  attempted_maps_context: boolean;
  maps_context_used: boolean;
  maps_context_failure_reason: string | null;
  weak_field_completion: {
    land_cost_completion: {
      signal_label: "strong" | "moderate" | "weak" | null;
      estimated_score_0_100: number | null;
      short_comment: string | null;
      confidence_0_100: number | null;
      source_basis:
        | "direct_grounded_evidence"
        | "indirect_grounded_evidence"
        | "maps_context"
        | "insufficient_evidence"
        | null;
    };
    grid_proximity_completion: {
      signal_label: "strong" | "moderate" | "weak" | null;
      estimated_score_0_100: number | null;
      short_comment: string | null;
      confidence_0_100: number | null;
      source_basis:
        | "direct_grounded_evidence"
        | "indirect_grounded_evidence"
        | "maps_context"
        | "insufficient_evidence"
        | null;
    };
  };
  state_or_site_summary: {
    summary_short: string | null;
    risk_short: string | null;
    still_to_verify: Array<string | null>;
  };
  debug_payload: {
    raw_observed_facts: Array<string | null>;
    raw_inferred_estimates: Array<string | null>;
    raw_data_gaps: Array<string | null>;
    raw_sources: Array<{
      title: string | null;
      url: string | null;
      source_type: string | null;
    }>;
  };
}

const FALLBACK_COMPLETION: GeminiCompletion = {
  query_area: "unknown",
  attempted_grounding: false,
  attempted_maps_context: false,
  maps_context_used: false,
  maps_context_failure_reason: "gemini_unavailable_or_disabled",
  weak_field_completion: {
    land_cost_completion: {
      signal_label: null,
      estimated_score_0_100: null,
      short_comment: null,
      confidence_0_100: null,
      source_basis: "insufficient_evidence",
    },
    grid_proximity_completion: {
      signal_label: null,
      estimated_score_0_100: null,
      short_comment: null,
      confidence_0_100: null,
      source_basis: "insufficient_evidence",
    },
  },
  state_or_site_summary: {
    summary_short: null,
    risk_short: null,
    still_to_verify: [null, null, null, null, null],
  },
  debug_payload: {
    raw_observed_facts: [null, null, null, null, null],
    raw_inferred_estimates: [null, null, null, null, null],
    raw_data_gaps: ["No grounded response", null, null, null, null],
    raw_sources: [],
  },
};

function sanitizeCompletion(raw: unknown): GeminiCompletion | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    const parsed = raw as GeminiCompletion;
    const cap = (n: number | null) => (typeof n === "number" ? Math.max(0, Math.min(100, n)) : null);
    const forceConfidence = (n: number | null, basis: string | null) => {
      const capped = cap(n);
      if (capped === null) return null;
      if (basis === "direct_grounded_evidence" || basis === "maps_context") return capped;
      return Math.min(capped, 60);
    };

    parsed.weak_field_completion.land_cost_completion.confidence_0_100 = forceConfidence(
      parsed.weak_field_completion.land_cost_completion.confidence_0_100,
      parsed.weak_field_completion.land_cost_completion.source_basis
    );
    parsed.weak_field_completion.grid_proximity_completion.confidence_0_100 = forceConfidence(
      parsed.weak_field_completion.grid_proximity_completion.confidence_0_100,
      parsed.weak_field_completion.grid_proximity_completion.source_basis
    );

    parsed.state_or_site_summary.still_to_verify = (parsed.state_or_site_summary.still_to_verify ?? [])
      .slice(0, 5);
    while (parsed.state_or_site_summary.still_to_verify.length < 5) {
      parsed.state_or_site_summary.still_to_verify.push(null);
    }
    return parsed;
  } catch {
    return null;
  }
}

async function runGeminiJson(prompt: string): Promise<any | null> {
  const key = readApiKey();
  if (!key) return null;
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 900,
        responseMimeType: "application/json",
      },
    });

    const text = await withTimeout(
      model.generateContent(prompt).then((r) => r.response.text()),
      TIMEOUT_MS
    );
    if (!text) return null;
    return JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, ""));
  } catch {
    return null;
  }
}

export async function completeWeakFieldsWithGemini(input: {
  state_code: string;
  state_name: string;
  lat: number;
  lng: number;
  current_land_cost_band: string;
  current_grid_band: string;
  language: "en" | "he";
}): Promise<GeminiCompletion> {
  const prompt = `Return ONLY valid JSON following exactly this schema and guardrails.
- attempted_grounding should be true if you attempted grounded web context.
- attempted_maps_context should be true if you attempted maps context.
- maps_context_used must be false if maps context not actually used.
- Do not fabricate parcel-level truths.
- If evidence weak, use null and insufficient_evidence.
- Confidence for weak evidence must be <= 60.

SCHEMA:
${JSON.stringify(FALLBACK_COMPLETION, null, 2)}

INPUT:
${JSON.stringify(input, null, 2)}
`;
  const raw = await runGeminiJson(prompt);
  const validated = sanitizeCompletion(raw);
  if (!validated) return { ...FALLBACK_COMPLETION, query_area: `${input.state_name} (${input.state_code})` };
  return validated;
}

export async function explainState(state: StateMacro): Promise<ExplainResponse> {
  const prompt = `Summarize this state for early-stage feasibility screening. Return JSON with summary, bullets, risks. Data: ${JSON.stringify(state)}`;
  const raw = await runGeminiJson(prompt);
  if (raw && typeof raw.summary === "string") {
    return {
      kind: "state",
      summary: raw.summary,
      bullets: Array.isArray(raw.bullets) ? raw.bullets.filter((x: unknown) => typeof x === "string") : [],
      risks: Array.isArray(raw.risks) ? raw.risks.filter((x: unknown) => typeof x === "string") : [],
      from_llm: true,
    };
  }
  return {
    kind: "state",
    summary: `${state.state_name} scores ${state.macro_total_score}/100 (${state.recommended_label}). ${state.macro_summary_seed}`,
    bullets: [
      `Solar potential score: ${state.average_solar_potential_score}/100`,
      `Land cost score: ${state.land_cost_score}/100`,
      `Open-land score: ${state.open_land_availability_score}/100`,
    ],
    risks: ["Parcel-level review still required.", "Flood/wetlands screening is preliminary."],
    from_llm: false,
  };
}

export async function explainSite(site: CandidateSite): Promise<ExplainResponse> {
  const prompt = `Summarize this candidate site for feasibility pre-screening. Return JSON with summary, bullets, risks. Data: ${JSON.stringify(site)}`;
  const raw = await runGeminiJson(prompt);
  if (raw && typeof raw.summary === "string") {
    return {
      kind: "site",
      summary: raw.summary,
      bullets: Array.isArray(raw.bullets) ? raw.bullets.filter((x: unknown) => typeof x === "string") : site.qualification_reasons,
      risks: Array.isArray(raw.risks) ? raw.risks.filter((x: unknown) => typeof x === "string") : site.caution_notes,
      from_llm: true,
    };
  }
  return {
    kind: "site",
    summary: `${site.title} feasibility score ${site.feasibility_score ?? site.overall_site_score}/100. ${site.gemini_summary_seed}`,
    bullets: site.qualification_reasons,
    risks: site.caution_notes,
    from_llm: false,
  };
}
