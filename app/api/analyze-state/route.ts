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
      // Persist ALL generated candidates so debug is recoverable even when
      // zero sites pass strict filters.
      await saveCandidateSites(
        run.id,
        result.candidates.map((s) => ({ ...s, run_id: run.id }))
      );
      await completeAnalysisRun(
        run.id,
        "completed",
        `Generated ${result.total_generated} candidates; ${result.passing.length} passed strict filters.`,
        result.run_debug
      );
    }

    return NextResponse.json({
      run_id: run?.id ?? null,
      status: "completed",
      generated: result.total_generated,
      passing: result.passing.length,
      // Return all candidates so the UI can always show debug, while still
      // exposing the passing ones explicitly.
      sites: result.passing,
      all_candidates: result.candidates,
      run_debug: result.run_debug,
    });
  } catch (error) {
    if (run) {
      await completeAnalysisRun(run.id, "failed", error instanceof Error ? error.message : "analysis_failed", null);
    }
    return NextResponse.json({ error: "analysis_failed" }, { status: 500 });
  }
}
