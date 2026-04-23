/**
 * Claude integration — Claude Opus via Anthropic SDK.
 *
 * Honesty rules (identical to Gemini):
 *  - Deterministic code is source of truth.
 *  - No grounding available → all evidence marked source_basis='insufficient_evidence' with confidence <= 40
 *  - Graceful no-op if ANTHROPIC_API_KEY is not set
 */

import type { CandidateSite, ExplainResponse, StateMacro } from "@/types/domain";
import type { GeminiCompletion } from "./gemini";

const MODEL = "claude-opus-4-5";
const TIMEOUT_MS = 60_000;

function readApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

export type ClaudeCompletion = GeminiCompletion;

function buildFallback(reason: string, queryArea = "unknown"): ClaudeCompletion {
  return {
    query_area: queryArea,
    model: MODEL,
    timeout_ms: TIMEOUT_MS,
    attempted_grounding: false,
    grounding_used: false,
    grounding_failure_reason: "claude_has_no_grounding",
    attempted_maps_context: false,
    maps_context_used: false,
    maps_context_failure_reason: "claude_has_no_maps_context",
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
      raw_observed_facts: [],
      raw_inferred_estimates: [],
      raw_data_gaps: [`Claude unavailable: ${reason}`],
      raw_sources: [],
      grounding_chunks: [],
      finish_reason: null,
      error: reason,
    },
  };
}

async function callClaude(prompt: string): Promise<string | null> {
  const key = readApiKey();
  if (!key) return null;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: key });

    const response = await Promise.race([
      client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);

    if (!response) return null;
    const content = (response as { content?: Array<{ type: string; text?: string }> }).content?.[0];
    if (!content || content.type !== "text") return null;
    return content.text ?? null;
  } catch {
    return null;
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function completeWeakFieldsWithClaude(input: {
  state_code: string;
  state_name: string;
  lat: number;
  lng: number;
  current_land_cost_band: string;
  current_grid_band: string;
  language: "en" | "he";
}): Promise<ClaudeCompletion> {
  const queryArea = `${input.state_name} (${input.state_code}) @ ${input.lat.toFixed(3)},${input.lng.toFixed(3)}`;
  const key = readApiKey();
  if (!key) return buildFallback("missing_anthropic_api_key", queryArea);

  const prompt = `You are an early-stage utility-scale solar land feasibility analyst.
Return ONLY valid JSON. No markdown, no prose outside JSON.

HARD RULES:
- Deterministic upstream code already decided pass/fail. You never override it.
- Do NOT fabricate parcel-level truths.
- No web search available. All evidence is from your training data only.
- Set confidence <= 40 for all fields (model prior only — no grounding).
- Set source_basis to "insufficient_evidence" for all fields.
- If evidence is weak, use nulls.

Return JSON with this exact shape:
{
  "weak_field_completion": {
    "land_cost_completion": {"signal_label": null, "estimated_score_0_100": null, "short_comment": null, "confidence_0_100": null, "source_basis": "insufficient_evidence"},
    "grid_proximity_completion": {"signal_label": null, "estimated_score_0_100": null, "short_comment": null, "confidence_0_100": null, "source_basis": "insufficient_evidence"}
  },
  "state_or_site_summary": {
    "summary_short": null,
    "risk_short": null,
    "still_to_verify": [null, null, null, null, null]
  },
  "debug_payload": {
    "raw_observed_facts": [],
    "raw_inferred_estimates": [],
    "raw_data_gaps": []
  }
}

INPUT: ${JSON.stringify({
    state_code: input.state_code,
    state_name: input.state_name,
    lat: input.lat,
    lng: input.lng,
    land_cost_band: input.current_land_cost_band,
    grid_band: input.current_grid_band,
    language: input.language,
  })}`;

  const text = await callClaude(prompt);
  if (!text) return buildFallback("claude_no_response", queryArea);

  const parsed = extractJson(text) as Record<string, unknown> | null;
  if (!parsed) return buildFallback("claude_json_parse_failed", queryArea);

  const result: ClaudeCompletion = {
    ...buildFallback("", queryArea),
    query_area: queryArea,
    debug_payload: {
      raw_observed_facts: [],
      raw_inferred_estimates: [],
      raw_data_gaps: [],
      raw_sources: [],
      grounding_chunks: [],
      finish_reason: "stop",
      error: null,
    },
  };

  const weak = (parsed.weak_field_completion as Record<string, unknown> | undefined) ?? {};
  const landCost = (weak.land_cost_completion as Record<string, unknown> | undefined) ?? {};
  const gridProx = (weak.grid_proximity_completion as Record<string, unknown> | undefined) ?? {};

  const landSignal = String(landCost.signal_label ?? "");
  result.weak_field_completion.land_cost_completion = {
    signal_label: (["strong", "moderate", "weak"].includes(landSignal)
      ? landCost.signal_label
      : null) as "strong" | "moderate" | "weak" | null,
    estimated_score_0_100:
      typeof landCost.estimated_score_0_100 === "number"
        ? Math.max(0, Math.min(100, landCost.estimated_score_0_100))
        : null,
    short_comment:
      typeof landCost.short_comment === "string" ? landCost.short_comment.slice(0, 240) : null,
    confidence_0_100:
      typeof landCost.confidence_0_100 === "number"
        ? Math.min(40, Math.max(0, landCost.confidence_0_100))
        : null,
    source_basis: "insufficient_evidence",
  };

  const gridSignal = String(gridProx.signal_label ?? "");
  result.weak_field_completion.grid_proximity_completion = {
    signal_label: (["strong", "moderate", "weak"].includes(gridSignal)
      ? gridProx.signal_label
      : null) as "strong" | "moderate" | "weak" | null,
    estimated_score_0_100:
      typeof gridProx.estimated_score_0_100 === "number"
        ? Math.max(0, Math.min(100, gridProx.estimated_score_0_100))
        : null,
    short_comment:
      typeof gridProx.short_comment === "string" ? gridProx.short_comment.slice(0, 240) : null,
    confidence_0_100:
      typeof gridProx.confidence_0_100 === "number"
        ? Math.min(40, Math.max(0, gridProx.confidence_0_100))
        : null,
    source_basis: "insufficient_evidence",
  };

  const summary = (parsed.state_or_site_summary as Record<string, unknown> | undefined) ?? {};
  result.state_or_site_summary.summary_short =
    typeof summary.summary_short === "string" ? summary.summary_short.slice(0, 300) : null;
  result.state_or_site_summary.risk_short =
    typeof summary.risk_short === "string" ? summary.risk_short.slice(0, 240) : null;

  return result;
}

export async function explainSiteWithClaude(site: CandidateSite): Promise<ExplainResponse> {
  const key = readApiKey();
  if (!key) {
    return {
      kind: "site",
      summary: `${site.title} feasibility score ${site.overall_site_score}/100.`,
      bullets: site.qualification_reasons,
      risks: site.caution_notes,
      from_llm: false,
    };
  }

  const prompt = `Summarize this candidate site for utility-scale solar feasibility pre-screening.
Return ONLY JSON: {"summary": string, "bullets": string[] (<=6), "risks": string[] (<=5)}.
Do not fabricate parcel-level or title facts. Note: no web search available; use training data only.
Data: ${JSON.stringify(site)}`;

  const text = await callClaude(prompt);
  if (!text) {
    return {
      kind: "site",
      summary: `${site.title} feasibility score ${site.overall_site_score}/100.`,
      bullets: site.qualification_reasons,
      risks: site.caution_notes,
      from_llm: false,
    };
  }

  const raw = extractJson(text) as { summary?: unknown; bullets?: unknown; risks?: unknown } | null;
  if (raw && typeof raw.summary === "string") {
    return {
      kind: "site",
      summary: raw.summary,
      bullets: Array.isArray(raw.bullets)
        ? raw.bullets.filter((x): x is string => typeof x === "string")
        : site.qualification_reasons,
      risks: Array.isArray(raw.risks)
        ? raw.risks.filter((x): x is string => typeof x === "string")
        : site.caution_notes,
      from_llm: true,
    };
  }

  return {
    kind: "site",
    summary: `${site.title} feasibility score ${site.overall_site_score}/100.`,
    bullets: site.qualification_reasons,
    risks: site.caution_notes,
    from_llm: false,
  };
}

export async function explainStateWithClaude(state: StateMacro): Promise<ExplainResponse> {
  const key = readApiKey();
  if (!key) {
    return {
      kind: "state",
      summary: `${state.state_name} scores ${state.macro_total_score}/100.`,
      bullets: [],
      risks: [],
      from_llm: false,
    };
  }

  const prompt = `Summarize this U.S. state for early-stage utility-scale solar feasibility screening.
Return ONLY JSON: {"summary": string, "bullets": string[] (<=6), "risks": string[] (<=5)}.
No web search available; use training data only. Do not fabricate parcel-level facts.
Data: ${JSON.stringify(state)}`;

  const text = await callClaude(prompt);
  if (!text) {
    return {
      kind: "state",
      summary: `${state.state_name} scores ${state.macro_total_score}/100.`,
      bullets: [],
      risks: [],
      from_llm: false,
    };
  }

  const raw = extractJson(text) as { summary?: unknown; bullets?: unknown; risks?: unknown } | null;
  if (raw && typeof raw.summary === "string") {
    return {
      kind: "state",
      summary: raw.summary,
      bullets: Array.isArray(raw.bullets)
        ? raw.bullets.filter((x): x is string => typeof x === "string")
        : [],
      risks: Array.isArray(raw.risks)
        ? raw.risks.filter((x): x is string => typeof x === "string")
        : [],
      from_llm: true,
    };
  }

  return {
    kind: "state",
    summary: `${state.state_name} scores ${state.macro_total_score}/100.`,
    bullets: [],
    risks: [],
    from_llm: false,
  };
}
