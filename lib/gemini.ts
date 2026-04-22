/**
 * Gemini integration — Gemini 3 Pro with grounded search support.
 *
 * Honesty rules (hard-wired):
 *  - Deterministic code is the source of truth. Gemini NEVER controls strict pass/fail.
 *  - attempted_grounding / attempted_maps_context are set based on what the code
 *    *actually* tried to do, not on prompt content.
 *  - maps_context_used / grounding_used are set based on *actual* response metadata.
 *  - When a capability is unavailable in the current API path, we record that
 *    honestly in `*_failure_reason` and fall back safely.
 */

import { GoogleGenAI } from "@google/genai";
import type { CandidateSite, ExplainResponse, StateMacro } from "@/types/domain";

const MODEL = process.env.GEMINI_MODEL || "gemini-3-pro-preview";
const TIMEOUT_MS = 120_000;

/** Google Maps grounding is only available via Vertex AI preview. Opt-in. */
const MAPS_GROUNDING_ENABLED =
  process.env.GEMINI_ENABLE_MAPS_GROUNDING === "true";

function readApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const t = setTimeout(() => {
      onTimeout?.();
      resolve(null);
    }, ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

type SourceBasis =
  | "direct_grounded_evidence"
  | "indirect_grounded_evidence"
  | "maps_context"
  | "insufficient_evidence"
  | null;

interface FieldCompletion {
  signal_label: "strong" | "moderate" | "weak" | null;
  estimated_score_0_100: number | null;
  short_comment: string | null;
  confidence_0_100: number | null;
  source_basis: SourceBasis;
}

export interface GroundingChunk {
  title: string | null;
  url: string | null;
  source_type: string | null;
}

export interface GeminiCompletion {
  query_area: string;
  model: string;
  timeout_ms: number;
  attempted_grounding: boolean;
  grounding_used: boolean;
  grounding_failure_reason: string | null;
  attempted_maps_context: boolean;
  maps_context_used: boolean;
  maps_context_failure_reason: string | null;
  weak_field_completion: {
    land_cost_completion: FieldCompletion;
    grid_proximity_completion: FieldCompletion;
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
    raw_sources: GroundingChunk[];
    grounding_chunks: GroundingChunk[];
    finish_reason: string | null;
    error: string | null;
  };
}

function emptyFieldCompletion(): FieldCompletion {
  return {
    signal_label: null,
    estimated_score_0_100: null,
    short_comment: null,
    confidence_0_100: null,
    source_basis: "insufficient_evidence",
  };
}

function buildFallback(reason: string, queryArea = "unknown"): GeminiCompletion {
  return {
    query_area: queryArea,
    model: MODEL,
    timeout_ms: TIMEOUT_MS,
    attempted_grounding: false,
    grounding_used: false,
    grounding_failure_reason: reason,
    attempted_maps_context: false,
    maps_context_used: false,
    maps_context_failure_reason: MAPS_GROUNDING_ENABLED
      ? reason
      : "maps_grounding_disabled_in_env",
    weak_field_completion: {
      land_cost_completion: emptyFieldCompletion(),
      grid_proximity_completion: emptyFieldCompletion(),
    },
    state_or_site_summary: {
      summary_short: null,
      risk_short: null,
      still_to_verify: [null, null, null, null, null],
    },
    debug_payload: {
      raw_observed_facts: [],
      raw_inferred_estimates: [],
      raw_data_gaps: [`Gemini unavailable: ${reason}`],
      raw_sources: [],
      grounding_chunks: [],
      finish_reason: null,
      error: reason,
    },
  };
}

const SCHEMA_SAMPLE = {
  weak_field_completion: {
    land_cost_completion: emptyFieldCompletion(),
    grid_proximity_completion: emptyFieldCompletion(),
  },
  state_or_site_summary: {
    summary_short: null,
    risk_short: null,
    still_to_verify: [null, null, null, null, null],
  },
  debug_payload: {
    raw_observed_facts: [],
    raw_inferred_estimates: [],
    raw_data_gaps: [],
  },
};

function capScore(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function sanitizeFieldCompletion(input: unknown): FieldCompletion {
  const fc = emptyFieldCompletion();
  if (!input || typeof input !== "object") return fc;
  const raw = input as Record<string, unknown>;

  const label = raw.signal_label;
  if (label === "strong" || label === "moderate" || label === "weak") {
    fc.signal_label = label;
  }

  fc.estimated_score_0_100 = capScore(raw.estimated_score_0_100);
  fc.short_comment =
    typeof raw.short_comment === "string" && raw.short_comment.trim() !== ""
      ? raw.short_comment.trim().slice(0, 400)
      : null;

  const basis = raw.source_basis;
  if (
    basis === "direct_grounded_evidence" ||
    basis === "indirect_grounded_evidence" ||
    basis === "maps_context" ||
    basis === "insufficient_evidence"
  ) {
    fc.source_basis = basis;
  } else {
    fc.source_basis = "insufficient_evidence";
  }

  const conf = capScore(raw.confidence_0_100);
  if (conf === null) {
    fc.confidence_0_100 = null;
  } else if (
    fc.source_basis === "direct_grounded_evidence" ||
    fc.source_basis === "maps_context"
  ) {
    fc.confidence_0_100 = conf;
  } else {
    // Weak / indirect evidence can never exceed 60 (honesty guardrail).
    fc.confidence_0_100 = Math.min(conf, 60);
  }

  return fc;
}

function sanitizeStringArray(input: unknown, max: number): Array<string | null> {
  const out: Array<string | null> = [];
  if (Array.isArray(input)) {
    for (const v of input) {
      if (out.length >= max) break;
      if (typeof v === "string" && v.trim() !== "") {
        out.push(v.trim().slice(0, 300));
      } else {
        out.push(null);
      }
    }
  }
  while (out.length < max) out.push(null);
  return out;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to locate the first {...} block.
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

interface GroundedJsonResult {
  parsed: unknown;
  attempted_grounding: boolean;
  grounding_used: boolean;
  grounding_failure_reason: string | null;
  grounding_chunks: GroundingChunk[];
  finish_reason: string | null;
  error: string | null;
}

/**
 * Call Gemini with googleSearch grounding enabled and an aggressive timeout.
 * Returns honest metadata about whether grounding was attempted / used.
 */
async function callGeminiWithGrounding(
  client: GoogleGenAI,
  prompt: string
): Promise<GroundedJsonResult> {
  // We always attempt grounding when this path is used.
  const attempted_grounding = true;
  const result: GroundedJsonResult = {
    parsed: null,
    attempted_grounding,
    grounding_used: false,
    grounding_failure_reason: null,
    grounding_chunks: [],
    finish_reason: null,
    error: null,
  };

  const request = {
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0.2,
      maxOutputTokens: 1200,
      // googleSearch is the grounding tool exposed by the Gemini Developer API
      // for v1 / v1beta — @google/genai maps this directly.
      tools: [{ googleSearch: {} }],
    },
  };

  const response = await withTimeout(
    // generateContent returns a single final response in the new SDK.
    client.models.generateContent(request),
    TIMEOUT_MS,
    () => {
      result.error = "gemini_timeout_120s";
    }
  );

  if (!response) {
    result.grounding_failure_reason =
      result.error ?? "no_response_from_gemini";
    result.error = result.error ?? "no_response_from_gemini";
    return result;
  }

  try {
    const candidate = (response as { candidates?: unknown[] }).candidates?.[0] as
      | Record<string, unknown>
      | undefined;

    if (candidate) {
      result.finish_reason =
        typeof candidate.finishReason === "string"
          ? (candidate.finishReason as string)
          : null;

      const gm = candidate.groundingMetadata as
        | { groundingChunks?: unknown[]; webSearchQueries?: unknown[] }
        | undefined;

      if (gm && Array.isArray(gm.groundingChunks) && gm.groundingChunks.length > 0) {
        for (const chunk of gm.groundingChunks) {
          const c = chunk as { web?: { uri?: string; title?: string } };
          if (c.web && (c.web.uri || c.web.title)) {
            result.grounding_chunks.push({
              title: c.web.title ?? null,
              url: c.web.uri ?? null,
              source_type: "web",
            });
          }
        }
        // Only mark as "used" if we actually got at least one chunk with
        // identifying content (title or URL). Empty-shell chunks do not count.
        if (result.grounding_chunks.length > 0) {
          result.grounding_used = true;
        } else {
          result.grounding_failure_reason = "grounding_chunks_empty_content";
        }
      } else {
        result.grounding_failure_reason = "no_grounding_chunks_returned";
      }
    }

    // text accessor — @google/genai exposes `.text` on the response.
    const text =
      typeof (response as { text?: unknown }).text === "string"
        ? ((response as { text: string }).text as string)
        : extractTextFromCandidate(
            (response as { candidates?: unknown[] }).candidates?.[0]
          );

    if (typeof text === "string" && text.trim() !== "") {
      result.parsed = extractJson(text);
    }
  } catch (err) {
    result.error =
      err instanceof Error ? err.message : "gemini_response_parse_error";
    result.grounding_failure_reason =
      result.grounding_failure_reason ?? result.error;
  }

  return result;
}

function extractTextFromCandidate(candidate: unknown): string {
  if (!candidate || typeof candidate !== "object") return "";
  const c = candidate as { content?: { parts?: unknown[] } };
  const parts = c.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => {
      if (p && typeof p === "object" && "text" in (p as Record<string, unknown>)) {
        const t = (p as { text?: unknown }).text;
        return typeof t === "string" ? t : "";
      }
      return "";
    })
    .join("");
}

/* ----------------------------- public API ----------------------------- */

export async function completeWeakFieldsWithGemini(input: {
  state_code: string;
  state_name: string;
  lat: number;
  lng: number;
  current_land_cost_band: string;
  current_grid_band: string;
  language: "en" | "he";
}): Promise<GeminiCompletion> {
  const queryArea = `${input.state_name} (${input.state_code}) @ ${input.lat.toFixed(3)},${input.lng.toFixed(3)}`;
  const key = readApiKey();
  if (!key) return buildFallback("missing_gemini_api_key", queryArea);

  const prompt = `You are an early-stage utility-scale solar land feasibility analyst.
Return ONLY valid JSON matching exactly the schema below. No markdown, no prose outside JSON.

HARD RULES:
- Deterministic upstream code already decided pass/fail. You never override it.
- Do NOT fabricate parcel-level truths (titles, ownership, exact interconnection costs, exact prices).
- If evidence is weak or indirect, set confidence <= 60 and source_basis to "indirect_grounded_evidence" or "insufficient_evidence".
- If no evidence is found, use nulls and "insufficient_evidence".
- short_comment <= 240 characters. summary_short <= 300 characters. risk_short <= 240 characters.
- still_to_verify is a list of up to 5 short bullet strings.
- raw_observed_facts and raw_sources should cite grounded web results when available.

SCHEMA (all keys required; additional keys forbidden):
${JSON.stringify(SCHEMA_SAMPLE, null, 2)}

INPUT:
${JSON.stringify(
  {
    kind: "candidate_site",
    language: input.language,
    state_code: input.state_code,
    state_name: input.state_name,
    lat: input.lat,
    lng: input.lng,
    current_land_cost_band: input.current_land_cost_band,
    current_grid_band: input.current_grid_band,
  },
  null,
  2
)}
`;

  let client: GoogleGenAI;
  try {
    client = new GoogleGenAI({ apiKey: key });
  } catch (err) {
    return buildFallback(
      err instanceof Error ? `client_init_failed:${err.message}` : "client_init_failed",
      queryArea
    );
  }

  const grounded = await callGeminiWithGrounding(client, prompt);

  const out: GeminiCompletion = {
    query_area: queryArea,
    model: MODEL,
    timeout_ms: TIMEOUT_MS,
    attempted_grounding: grounded.attempted_grounding,
    grounding_used: grounded.grounding_used,
    grounding_failure_reason: grounded.grounding_failure_reason,
    // Maps context: the Gemini Developer API (@google/genai public endpoint)
    // does not expose a stable maps-grounding tool. We only flip
    // attempted_maps_context=true if someone opts in AND we would have a
    // dedicated code path — which we currently do not, so we are honest.
    attempted_maps_context: false,
    maps_context_used: false,
    maps_context_failure_reason: MAPS_GROUNDING_ENABLED
      ? "maps_grounding_not_available_in_current_api_path"
      : "maps_grounding_disabled_in_env",
    weak_field_completion: {
      land_cost_completion: emptyFieldCompletion(),
      grid_proximity_completion: emptyFieldCompletion(),
    },
    state_or_site_summary: {
      summary_short: null,
      risk_short: null,
      still_to_verify: [null, null, null, null, null],
    },
    debug_payload: {
      raw_observed_facts: [],
      raw_inferred_estimates: [],
      raw_data_gaps: [],
      raw_sources: grounded.grounding_chunks,
      grounding_chunks: grounded.grounding_chunks,
      finish_reason: grounded.finish_reason,
      error: grounded.error,
    },
  };

  const parsed = grounded.parsed as Record<string, unknown> | null;
  if (parsed && typeof parsed === "object") {
    const weak = parsed.weak_field_completion as Record<string, unknown> | undefined;
    if (weak) {
      out.weak_field_completion.land_cost_completion = sanitizeFieldCompletion(
        weak.land_cost_completion
      );
      out.weak_field_completion.grid_proximity_completion = sanitizeFieldCompletion(
        weak.grid_proximity_completion
      );
    }

    const summary = parsed.state_or_site_summary as Record<string, unknown> | undefined;
    if (summary) {
      const s = summary.summary_short;
      const r = summary.risk_short;
      out.state_or_site_summary.summary_short =
        typeof s === "string" && s.trim() !== "" ? s.trim().slice(0, 300) : null;
      out.state_or_site_summary.risk_short =
        typeof r === "string" && r.trim() !== "" ? r.trim().slice(0, 240) : null;
      out.state_or_site_summary.still_to_verify = sanitizeStringArray(
        summary.still_to_verify,
        5
      );
    }

    const dbg = parsed.debug_payload as Record<string, unknown> | undefined;
    if (dbg) {
      out.debug_payload.raw_observed_facts = sanitizeStringArray(
        dbg.raw_observed_facts,
        6
      );
      out.debug_payload.raw_inferred_estimates = sanitizeStringArray(
        dbg.raw_inferred_estimates,
        6
      );
      out.debug_payload.raw_data_gaps = sanitizeStringArray(dbg.raw_data_gaps, 6);
    }
  }

  return out;
}

/* ------------------------- natural-language explain ------------------------- */

async function runGeminiTextJson(prompt: string): Promise<unknown | null> {
  const key = readApiKey();
  if (!key) return null;
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const response = await withTimeout(
      client.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 900,
          tools: [{ googleSearch: {} }],
        },
      }),
      TIMEOUT_MS
    );
    if (!response) return null;
    const text =
      typeof (response as { text?: unknown }).text === "string"
        ? ((response as { text: string }).text as string)
        : extractTextFromCandidate(
            (response as { candidates?: unknown[] }).candidates?.[0]
          );
    if (!text) return null;
    return extractJson(text);
  } catch {
    return null;
  }
}

export async function explainState(state: StateMacro): Promise<ExplainResponse> {
  const prompt = `Summarize this U.S. state for early-stage utility-scale solar feasibility screening.
Return ONLY JSON: {"summary": string, "bullets": string[] (<=6), "risks": string[] (<=5)}.
Do not fabricate parcel-level facts.
Data: ${JSON.stringify(state)}`;
  const raw = (await runGeminiTextJson(prompt)) as
    | { summary?: unknown; bullets?: unknown; risks?: unknown }
    | null;
  if (raw && typeof raw.summary === "string") {
    return {
      kind: "state",
      summary: raw.summary,
      bullets: Array.isArray(raw.bullets)
        ? raw.bullets.filter((x: unknown): x is string => typeof x === "string")
        : [],
      risks: Array.isArray(raw.risks)
        ? raw.risks.filter((x: unknown): x is string => typeof x === "string")
        : [],
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
    risks: [
      "Parcel-level review still required.",
      "Flood/wetlands screening is preliminary.",
    ],
    from_llm: false,
  };
}

export async function explainSite(site: CandidateSite): Promise<ExplainResponse> {
  const prompt = `Summarize this candidate site for utility-scale solar feasibility pre-screening.
Return ONLY JSON: {"summary": string, "bullets": string[] (<=6), "risks": string[] (<=5)}.
Do not fabricate parcel-level or title facts.
Data: ${JSON.stringify(site)}`;
  const raw = (await runGeminiTextJson(prompt)) as
    | { summary?: unknown; bullets?: unknown; risks?: unknown }
    | null;
  if (raw && typeof raw.summary === "string") {
    return {
      kind: "site",
      summary: raw.summary,
      bullets: Array.isArray(raw.bullets)
        ? raw.bullets.filter((x: unknown): x is string => typeof x === "string")
        : site.qualification_reasons,
      risks: Array.isArray(raw.risks)
        ? raw.risks.filter((x: unknown): x is string => typeof x === "string")
        : site.caution_notes,
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
