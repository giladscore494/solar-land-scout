import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { routeExplainSite, routeExplainState, type LLMPreference } from "@/lib/llm-router";
import type { ExplainResponse } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExplainRequest {
  kind: "state" | "site";
  /** State code when kind === "state"; site id when kind === "site". */
  id: string;
  /** Optional LLM preference. Defaults to "auto" (Gemini preferred, Claude fallback). */
  prefer?: "gemini" | "claude" | "auto";
}

export async function POST(req: NextRequest) {
  let body: ExplainRequest;
  try {
    body = (await req.json()) as ExplainRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body || (body.kind !== "state" && body.kind !== "site") || !body.id) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const prefer: LLMPreference =
    body.prefer === "gemini" || body.prefer === "claude" ? body.prefer : "auto";

  const repo = getRepository();
  try {
    if (body.kind === "state") {
      const s = await repo.getState(body.id);
      if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const out: ExplainResponse = await routeExplainState(s, prefer);
      return NextResponse.json(out);
    } else {
      const site = await repo.getSite(body.id);
      if (!site) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const out: ExplainResponse = await routeExplainSite(site, prefer);
      return NextResponse.json(out);
    }
  } catch {
    return NextResponse.json({ error: "explain_failed" }, { status: 500 });
  }
}
