import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { applyUserFilters, parseSiteFilters } from "@/lib/filters";
import { enrichSites, isStale } from "@/lib/enrichment/orchestrate";
import type { SitesResponse } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const repo = getRepository();
  const filters = parseSiteFilters(req.nextUrl.searchParams);
  const wantEnrich = req.nextUrl.searchParams.get("enrich") === "1";

  let all = filters.state_code
    ? await repo.listSitesByState(filters.state_code)
    : await repo.listSites();

  if (wantEnrich) {
    const stale = all.filter((s) => isStale(s));
    if (stale.length > 0) {
      const enriched = await enrichSites(stale, 4);
      const byId = new Map(enriched.map((s) => [s.id, s]));
      all = all.map((s) => byId.get(s.id) ?? s);
    }
  }

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
