import { NextRequest, NextResponse } from "next/server";
import { listAnalysisRuns } from "@/lib/analysis-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("state");
  if (!code) return NextResponse.json({ runs: [] });
  const runs = await listAnalysisRuns(code.toUpperCase());
  return NextResponse.json({ runs });
}
