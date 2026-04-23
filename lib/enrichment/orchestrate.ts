/**
 * Enrichment orchestrator.
 *
 * Runs all Tier 1 enrichers (and optionally Google Solar Tier 2) in parallel
 * against a single 5s global AbortController. Merges patches in a deterministic
 * order, appends provenance, and recomputes the site score + strict-filter gate.
 */

import type { CandidateSite, EnrichmentProvenance } from "@/types/domain";
import { computeSiteScore } from "@/lib/scoring";
import { passesStrictFilters } from "@/lib/filters";
import { getPostgresPool } from "@/lib/postgres";
import { ensureSchema } from "@/lib/db-schema";

import type { EnrichmentResult, SiteEnricher } from "./index";
import { nasaPowerEnricher } from "./nasa-power";
import { usgsElevationEnricher } from "./usgs-elevation";
import { osmInfraEnricher } from "./osm-infra";
import { padusEnricher } from "./padus";
import { femaFloodEnricher } from "./fema-flood";
import { googleSolarEnricher } from "./google-solar";

const TIER_1: SiteEnricher[] = [
  nasaPowerEnricher,
  usgsElevationEnricher,
  osmInfraEnricher,
  padusEnricher,
  femaFloodEnricher,
];

const GLOBAL_TIMEOUT_MS = 5000;

/** Merge a partial patch into a site, preferring the patch's non-null values. */
function merge(site: CandidateSite, patch: Partial<CandidateSite>): CandidateSite {
  const next: CandidateSite = { ...site };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (next as unknown as Record<string, unknown>)[k] = v as unknown;
  }
  return next;
}

async function cacheGet(
  siteId: string,
  source: string,
  ttlMs: number
): Promise<EnrichmentResult | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  try {
    await ensureSchema(pool);
    const res = (await pool.query(
      `SELECT payload, computed_at FROM site_enrichment_cache WHERE site_id=$1 AND source=$2 LIMIT 1`,
      [siteId, source]
    )) as { rows: { payload: EnrichmentResult; computed_at: string }[] };
    const row = res.rows[0];
    if (!row) return null;
    const ageMs = Date.now() - new Date(row.computed_at).getTime();
    if (ageMs > ttlMs) return null;
    return row.payload;
  } catch {
    return null;
  }
}

async function cachePut(siteId: string, source: string, result: EnrichmentResult): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO site_enrichment_cache (site_id, source, payload, computed_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (site_id, source) DO UPDATE SET payload=EXCLUDED.payload, computed_at=NOW()`,
      [siteId, source, JSON.stringify(result)]
    );
  } catch {
    // non-fatal
  }
}

async function persistEnriched(site: CandidateSite): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE candidate_sites SET
        slope_estimate=$2,
        solar_resource_value=$3,
        distance_to_infra_estimate=$4,
        distance_to_infra_km=$5,
        in_protected_area=$6,
        protected_area_name=$7,
        flood_zone=$8,
        in_flood_zone=$9,
        google_solar_json=$10::jsonb,
        enrichment_provenance_json=$11::jsonb,
        enrichment_updated_at=NOW(),
        overall_site_score=$12,
        passes_strict_filters=$13
      WHERE id=$1`,
      [
        site.id,
        site.slope_estimate,
        site.solar_resource_value,
        site.distance_to_infra_estimate,
        site.distance_to_infra_km ?? null,
        site.in_protected_area ?? null,
        site.protected_area_name ?? null,
        site.flood_zone ?? null,
        site.in_flood_zone ?? null,
        JSON.stringify(site.google_solar ?? null),
        JSON.stringify(site.enrichment_provenance ?? []),
        site.overall_site_score,
        site.passes_strict_filters,
      ]
    );
  } catch {
    // non-fatal — keep app healthy even if persistence fails
  }
}

export interface EnrichOptions {
  ttlMs?: number;
  /** persist result back to DB (default true) */
  persist?: boolean;
}

/** Enrich a single candidate site. */
export async function enrichSite(
  site: CandidateSite,
  opts: EnrichOptions = {}
): Promise<CandidateSite> {
  const ttlMs = opts.ttlMs ?? 30 * 24 * 3600 * 1000;
  const persist = opts.persist !== false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GLOBAL_TIMEOUT_MS);

  const enrichers = [...TIER_1];
  if (process.env.GOOGLE_SOLAR_API_KEY?.trim()) enrichers.push(googleSolarEnricher);

  const results = await Promise.allSettled(
    enrichers.map(async (e): Promise<[string, EnrichmentResult]> => {
      const cached = await cacheGet(site.id, e.name, ttlMs);
      if (cached) return [e.name, cached];
      const r = await e.enrich(site, ctrl.signal);
      if (r.provenance.status === "ok") {
        await cachePut(site.id, e.name, r);
      }
      return [e.name, r];
    })
  );

  clearTimeout(timer);

  // Deterministic merge order (matches TIER_1 + google_solar appended).
  const resultsByName = new Map<string, EnrichmentResult>();
  for (const r of results) {
    if (r.status === "fulfilled") resultsByName.set(r.value[0], r.value[1]);
  }

  const order = [
    "nasa_power",
    "usgs_elevation",
    "osm_infra",
    "usgs_padus",
    "fema_flood",
    "google_solar",
  ];

  let next = { ...site } as CandidateSite;
  const provenance: EnrichmentProvenance[] = [];
  for (const name of order) {
    const r = resultsByName.get(name);
    if (!r) continue;
    if (Object.keys(r.patch).length > 0) next = merge(next, r.patch);
    provenance.push(r.provenance);
  }

  next.enrichment_provenance = provenance;
  next.enrichment_updated_at = new Date().toISOString();
  next.overall_site_score = computeSiteScore(next);
  next.passes_strict_filters = passesStrictFilters(next);

  if (persist) await persistEnriched(next);
  return next;
}

/** Enrich a batch of sites with bounded concurrency (Overpass rate limits). */
export async function enrichSites(
  sites: CandidateSite[],
  concurrency = 4,
  opts: EnrichOptions = {}
): Promise<CandidateSite[]> {
  const out: CandidateSite[] = new Array(sites.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < sites.length) {
      const mine = idx++;
      try {
        out[mine] = await enrichSite(sites[mine], opts);
      } catch {
        out[mine] = sites[mine];
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, sites.length)) }, () =>
    worker()
  );
  await Promise.all(workers);
  return out;
}

export function isStale(site: CandidateSite, ttlMs = 30 * 24 * 3600 * 1000): boolean {
  if (!site.enrichment_provenance || site.enrichment_provenance.length === 0) return true;
  if (!site.enrichment_updated_at) return true;
  return Date.now() - new Date(site.enrichment_updated_at).getTime() > ttlMs;
}
