/**
 * LLM Router — selects between Gemini and Claude for explain/complete calls.
 *
 * Default strategy: prefer Gemini (it has Grounding with Google Search).
 * Falls back to Claude when Gemini is unavailable (no key or quota error).
 * Pass prefer="claude" to force Claude.
 */

import type { CandidateSite, ExplainResponse, StateMacro } from "@/types/domain";
import {
  explainSite as geminiExplainSite,
  explainState as geminiExplainState,
} from "./gemini";
import {
  explainSiteWithClaude,
  explainStateWithClaude,
} from "./claude";

export type LLMPreference = "auto" | "gemini" | "claude";

function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

function hasClaude(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export async function routeExplainSite(
  site: CandidateSite,
  prefer: LLMPreference = "auto"
): Promise<ExplainResponse> {
  if (prefer === "claude") {
    return explainSiteWithClaude(site);
  }

  if (prefer === "gemini" || hasGemini()) {
    try {
      return await geminiExplainSite(site);
    } catch {
      if (hasClaude()) return explainSiteWithClaude(site);
      throw new Error("Gemini failed and Claude is not configured");
    }
  }

  if (hasClaude()) {
    return explainSiteWithClaude(site);
  }

  return {
    kind: "site",
    summary: `${site.title} feasibility score ${site.overall_site_score}/100.`,
    bullets: site.qualification_reasons,
    risks: site.caution_notes,
    from_llm: false,
  };
}

export async function routeExplainState(
  state: StateMacro,
  prefer: LLMPreference = "auto"
): Promise<ExplainResponse> {
  if (prefer === "claude") {
    return explainStateWithClaude(state);
  }

  if (prefer === "gemini" || hasGemini()) {
    try {
      return await geminiExplainState(state);
    } catch {
      if (hasClaude()) return explainStateWithClaude(state);
      throw new Error("Gemini failed and Claude is not configured");
    }
  }

  if (hasClaude()) {
    return explainStateWithClaude(state);
  }

  return {
    kind: "state",
    summary: `${state.state_name} scores ${state.macro_total_score}/100.`,
    bullets: [],
    risks: [],
    from_llm: false,
  };
}
