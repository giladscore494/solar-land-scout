/**
 * USGS Elevation Point Query Service — computes a true slope by sampling
 * the target point and 4 neighbors at ±100m offsets.
 */

import type { CandidateSite } from "@/types/domain";
import {
  LRUCache,
  nowIso,
  safeFetch,
  type EnrichmentResult,
  type SiteEnricher,
} from "./index";

const ENDPOINT = "https://epqs.nationalmap.gov/v1/json";
const cache = new LRUCache<number>(2000);

/** Fetch elevation (meters) for a single point; null on failure. */
async function elevationAt(
  lat: number,
  lng: number,
  signal: AbortSignal
): Promise<number | null> {
  const cached = cache.get(lat, lng, "elev");
  if (cached !== null) return cached;
  const url = `${ENDPOINT}?x=${encodeURIComponent(
    String(lng)
  )}&y=${encodeURIComponent(String(lat))}&units=Meters&wkid=4326&includeDate=False`;
  const res = await safeFetch(url, { timeoutMs: 2500 }, signal);
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { value?: number | string };
    const v = typeof data.value === "string" ? Number(data.value) : data.value;
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    cache.set(lat, lng, v, "elev");
    return v;
  } catch {
    return null;
  }
}

export const usgsElevationEnricher: SiteEnricher = {
  name: "usgs_elevation",
  async enrich(site: CandidateSite, signal: AbortSignal): Promise<EnrichmentResult> {
    const start = Date.now();
    // ~100m offset in degrees. Meters→deg approximation (cosine latitude).
    const dLat = 100 / 111_320;
    const dLng = 100 / (111_320 * Math.max(0.1, Math.cos((site.lat * Math.PI) / 180)));

    const [c, n, s, e, w] = await Promise.all([
      elevationAt(site.lat, site.lng, signal),
      elevationAt(site.lat + dLat, site.lng, signal),
      elevationAt(site.lat - dLat, site.lng, signal),
      elevationAt(site.lat, site.lng + dLng, signal),
      elevationAt(site.lat, site.lng - dLng, signal),
    ]);

    const latency_ms = Date.now() - start;

    if (c === null) {
      return {
        patch: {},
        provenance: {
          source: "usgs_elevation",
          at: nowIso(),
          status: signal.aborted ? "timeout" : "error",
          latency_ms,
          note: "center elevation unavailable",
        },
      };
    }

    const neighbours = [n, s, e, w].filter(
      (v): v is number => typeof v === "number"
    );
    if (neighbours.length === 0) {
      return {
        patch: {},
        provenance: {
          source: "usgs_elevation",
          at: nowIso(),
          status: "error",
          latency_ms,
          note: "no neighbour elevations",
        },
      };
    }

    const maxDelta = Math.max(...neighbours.map((v) => Math.abs(v - c)));
    // Slope % = 100 * rise / run (run is 100 m).
    const slopePct = Math.max(0, Math.min(100, (100 * maxDelta) / 100));
    const rounded = Number(slopePct.toFixed(2));

    return {
      patch: { slope_estimate: rounded },
      provenance: {
        source: "usgs_elevation",
        at: nowIso(),
        status: "ok",
        latency_ms,
        note: `center=${c.toFixed(1)}m, max_delta=${maxDelta.toFixed(1)}m`,
      },
    };
  },
};
