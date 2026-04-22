import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import type { AnalysisRunsResponse } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const stateCode = req.nextUrl.searchParams.get("state");
  if (!stateCode) {
    return NextResponse.json({ error: "state_required" }, { status: 400 });
  }
  const repo = getRepository();
  const [runs, dbAvailable] = await Promise.all([repo.listAnalysisRuns(stateCode.toUpperCase()), repo.isDatabaseAvailable()]);
  const body: AnalysisRunsResponse = {
    runs,
    latest_run: runs[0] ?? null,
    db_available: dbAvailable,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
