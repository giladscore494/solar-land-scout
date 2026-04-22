import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { applyUserFilters, parseSiteFilters } from "@/lib/filters";
import type { SitesResponse } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = getRepository();
  const filters = parseSiteFilters(req.nextUrl.searchParams);
  const [all, latestAnalysisRun, dbAvailable] = await Promise.all([
    filters.state_code ? repo.listSitesByState(filters.state_code) : repo.listSites(),
    filters.state_code ? repo.getLatestAnalysisRun(filters.state_code) : Promise.resolve(null),
    repo.isDatabaseAvailable(),
  ]);
  const filtered = applyUserFilters(all, filters);
  const body: SitesResponse = {
    sites: filtered,
    total_before_filters: all.length,
    total_after_filters: filtered.length,
    generated_at: new Date().toISOString(),
    db_available: dbAvailable,
    latest_analysis_run: latestAnalysisRun,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
