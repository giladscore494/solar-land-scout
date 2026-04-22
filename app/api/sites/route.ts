import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { applyUserFilters, parseSiteFilters } from "@/lib/filters";
import type { SitesResponse } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = getRepository();
  const filters = parseSiteFilters(req.nextUrl.searchParams);

  const all = filters.state_code
    ? await repo.listSitesByState(filters.state_code)
    : await repo.listSites();

  const filtered = applyUserFilters(all, filters);

  const body: SitesResponse = {
    sites: filtered,
    total_before_filters: all.length,
    total_after_filters: filtered.length,
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
