import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { createAnalysisRun, completeAnalysisRun, saveCandidateSites } from "@/lib/analysis-runs";
import { runStateAnalysis } from "@/lib/analysis-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { state_code?: string; language?: "en" | "he" } | null;
  const stateCode = body?.state_code?.toUpperCase();
  const language = body?.language === "he" ? "he" : "en";
  if (!stateCode) return NextResponse.json({ error: "state_code_required" }, { status: 400 });

  const repo = getRepository();
  const state = await repo.getState(stateCode);
  if (!state) return NextResponse.json({ error: "state_not_found" }, { status: 404 });

  const run = await createAnalysisRun(stateCode, language);

  try {
    const result = await runStateAnalysis(state, language);
    if (run) {
      await saveCandidateSites(run.id, result.passing.map((s) => ({ ...s, run_id: run.id })));
      await completeAnalysisRun(run.id, "completed", `Generated ${result.total_generated} candidates; ${result.passing.length} passed strict filters.`, {
        state_code: stateCode,
        generated: result.total_generated,
        passing: result.passing.length,
        sample: result.passing[0]?.gemini_debug_json ?? null,
      });
    }

    return NextResponse.json({
      run_id: run?.id ?? null,
      status: "completed",
      generated: result.total_generated,
      passing: result.passing.length,
      sites: result.passing,
    });
  } catch (error) {
    if (run) {
      await completeAnalysisRun(run.id, "failed", error instanceof Error ? error.message : "analysis_failed", null);
    }
    return NextResponse.json({ error: "analysis_failed" }, { status: 500 });
  }
}
