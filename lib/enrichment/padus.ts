/**
 * USGS PAD-US 4.0 — flags sites that fall inside a protected area.
 * Hard exclusion enricher: patches { in_protected_area, protected_area_name }.
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
  "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Protected_Areas_Database_of_the_United_States_PAD_US_4_0/FeatureServer/0/query";

const cache = new LRUCache<{ inside: boolean; name: string | null }>(1000);

interface ArcGisFeature {
  attributes?: { Unit_Nm?: string | null; Des_Tp?: string | null; Mang_Type?: string | null };
}

export const padusEnricher: SiteEnricher = {
  name: "usgs_padus",
  async enrich(site: CandidateSite, signal: AbortSignal): Promise<EnrichmentResult> {
    const start = Date.now();
    const cached = cache.get(site.lat, site.lng, "padus");
    if (cached) {
      return {
        patch: {
          in_protected_area: cached.inside,
          protected_area_name: cached.name,
        },
        provenance: {
          source: "usgs_padus",
          at: nowIso(),
          status: "ok",
          latency_ms: 0,
          note: "cache hit",
        },
      };
    }

    const geom = encodeURIComponent(JSON.stringify({ x: site.lng, y: site.lat, spatialReference: { wkid: 4326 } }));
    const url = `${ENDPOINT}?f=json&geometry=${geom}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelWithin&outFields=Unit_Nm,Des_Tp,Mang_Type&returnGeometry=false&resultRecordCount=1`;

    const res = await safeFetch(url, { timeoutMs: 2500 }, signal);
    const latency_ms = Date.now() - start;
    if (!res || !res.ok) {
      return {
        patch: {},
        provenance: {
          source: "usgs_padus",
          at: nowIso(),
          status: signal.aborted ? "timeout" : "error",
          latency_ms,
          note: res ? `HTTP ${res.status}` : "network error",
        },
      };
    }

    try {
      const data = (await res.json()) as { features?: ArcGisFeature[] };
      const feats = data.features ?? [];
      const inside = feats.length > 0;
      const name = inside ? feats[0]?.attributes?.Unit_Nm ?? null : null;
      cache.set(site.lat, site.lng, { inside, name }, "padus");
      return {
        patch: {
          in_protected_area: inside,
          protected_area_name: name,
        },
        provenance: {
          source: "usgs_padus",
          at: nowIso(),
          status: "ok",
          latency_ms,
          note: inside ? `inside ${name ?? "protected area"}` : "not inside",
        },
      };
    } catch {
      return {
        patch: {},
        provenance: {
          source: "usgs_padus",
          at: nowIso(),
          status: "error",
          latency_ms,
          note: "parse error",
        },
      };
    }
  },
};
