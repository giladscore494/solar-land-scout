/**
 * OSM Overpass — find nearest grid infrastructure (power lines + substations)
 * within 20 km of the site. Produces a band + numeric distance in km.
 */

import type { CandidateSite, InfraProximity } from "@/types/domain";
import {
  LRUCache,
  haversineKm,
  nowIso,
  safeFetch,
  type EnrichmentResult,
  type SiteEnricher,
} from "./index";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const cache = new LRUCache<{ km: number; band: InfraProximity }>(500);

function band(km: number): InfraProximity {
  if (km < 5) return "near";
  if (km < 15) return "moderate";
  return "far";
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

export const osmInfraEnricher: SiteEnricher = {
  name: "osm_infra",
  async enrich(site: CandidateSite, signal: AbortSignal): Promise<EnrichmentResult> {
    const start = Date.now();
    const cached = cache.get(site.lat, site.lng, "osm");
    if (cached) {
      return {
        patch: {
          distance_to_infra_estimate: cached.band,
          distance_to_infra_km: cached.km,
        },
        provenance: {
          source: "osm_infra",
          at: nowIso(),
          status: "ok",
          latency_ms: 0,
          note: "cache hit",
        },
      };
    }

    const radius = 20_000;
    const query = `[out:json][timeout:20];(
      way(around:${radius},${site.lat},${site.lng})["power"="line"];
      node(around:${radius},${site.lat},${site.lng})["power"="substation"];
      way(around:${radius},${site.lat},${site.lng})["power"="substation"];
    );out center;`;
    const body = new URLSearchParams({ data: query }).toString();
    const res = await safeFetch(
      ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        timeoutMs: 2500,
      },
      signal
    );
    const latency_ms = Date.now() - start;

    if (!res || !res.ok) {
      return {
        patch: {},
        provenance: {
          source: "osm_infra",
          at: nowIso(),
          status: signal.aborted ? "timeout" : "error",
          latency_ms,
          note: res ? `HTTP ${res.status}` : "network error",
        },
      };
    }

    try {
      const data = (await res.json()) as { elements?: OverpassElement[] };
      const elements = data.elements ?? [];
      if (elements.length === 0) {
        return {
          patch: { distance_to_infra_estimate: "far", distance_to_infra_km: radius / 1000 },
          provenance: {
            source: "osm_infra",
            at: nowIso(),
            status: "ok",
            latency_ms,
            note: "no features within 20km",
          },
        };
      }

      let best = Number.POSITIVE_INFINITY;
      for (const el of elements) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (typeof lat !== "number" || typeof lon !== "number") continue;
        const km = haversineKm(site.lat, site.lng, lat, lon);
        if (km < best) best = km;
      }
      if (!Number.isFinite(best)) {
        return {
          patch: {},
          provenance: {
            source: "osm_infra",
            at: nowIso(),
            status: "error",
            latency_ms,
            note: "no usable geometry in result",
          },
        };
      }
      const b = band(best);
      const rounded = Number(best.toFixed(2));
      cache.set(site.lat, site.lng, { km: rounded, band: b }, "osm");
      return {
        patch: { distance_to_infra_estimate: b, distance_to_infra_km: rounded },
        provenance: {
          source: "osm_infra",
          at: nowIso(),
          status: "ok",
          latency_ms,
          note: `nearest=${rounded}km (${b})`,
        },
      };
    } catch {
      return {
        patch: {},
        provenance: {
          source: "osm_infra",
          at: nowIso(),
          status: "error",
          latency_ms,
          note: "parse error",
        },
      };
    }
  },
};
