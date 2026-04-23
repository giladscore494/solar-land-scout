/**
 * FEMA NFHL — flags sites inside an SFHA (flood zones beginning with A or V).
 */

import type { CandidateSite } from "@/types/domain";
import {
  LRUCache,
  nowIso,
  safeFetch,
  type EnrichmentResult,
  type SiteEnricher,
} from "./index";

const ENDPOINT =
  "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";

const cache = new LRUCache<{ zone: string | null; inside: boolean }>(1000);

interface ArcGisFloodFeature {
  attributes?: { FLD_ZONE?: string | null };
}

export const femaFloodEnricher: SiteEnricher = {
  name: "fema_flood",
  async enrich(site: CandidateSite, signal: AbortSignal): Promise<EnrichmentResult> {
    const start = Date.now();
    const cached = cache.get(site.lat, site.lng, "fema");
    if (cached) {
      return {
        patch: { flood_zone: cached.zone, in_flood_zone: cached.inside },
        provenance: {
          source: "fema_flood",
          at: nowIso(),
          status: "ok",
          latency_ms: 0,
          note: "cache hit",
        },
      };
    }

    const geom = encodeURIComponent(
      JSON.stringify({ x: site.lng, y: site.lat, spatialReference: { wkid: 4326 } })
    );
    const url = `${ENDPOINT}?f=json&geometry=${geom}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE&returnGeometry=false&resultRecordCount=1`;

    const res = await safeFetch(url, { timeoutMs: 2500 }, signal);
    const latency_ms = Date.now() - start;
    if (!res || !res.ok) {
      return {
        patch: {},
        provenance: {
          source: "fema_flood",
          at: nowIso(),
          status: signal.aborted ? "timeout" : "error",
          latency_ms,
          note: res ? `HTTP ${res.status}` : "network error",
        },
      };
    }

    try {
      const data = (await res.json()) as { features?: ArcGisFloodFeature[] };
      const feats = data.features ?? [];
      const zone = feats[0]?.attributes?.FLD_ZONE ?? null;
      const inside = !!zone && (zone.startsWith("A") || zone.startsWith("V"));
      cache.set(site.lat, site.lng, { zone, inside }, "fema");
      return {
        patch: { flood_zone: zone, in_flood_zone: inside },
        provenance: {
          source: "fema_flood",
          at: nowIso(),
          status: "ok",
          latency_ms,
          note: zone ? `zone=${zone}${inside ? " (high-risk)" : ""}` : "no zone",
        },
      };
    } catch {
      return {
        patch: {},
        provenance: {
          source: "fema_flood",
          at: nowIso(),
          status: "error",
          latency_ms,
          note: "parse error",
        },
      };
    }
  },
};
