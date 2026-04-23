import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { enrichSites, isStale } from "@/lib/enrichment/orchestrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/enrich/run
 *
 * Iterates all sites, running Tier 1 enrichment for any site whose
 * enrichment_provenance is empty OR older than 30 days. Returns a summary
 * including counts of enriched vs skipped.
 */
export async function POST() {
  const repo = getRepository();
  const sites = await repo.listSites();
  const stale = sites.filter((s) => isStale(s));
  const enriched = await enrichSites(stale, 4);
  return NextResponse.json(
    {
      ok: true,
      total: sites.length,
      enriched: enriched.length,
      skipped: sites.length - enriched.length,
      generated_at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
