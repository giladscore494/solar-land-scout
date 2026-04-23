/**
 * Google Solar API — Tier 2 enricher. Only runs when GOOGLE_SOLAR_API_KEY is
 * configured. Includes a module-level daily cost guard.
 */

import type { CandidateSite } from "@/types/domain";
import { LRUCache, nowIso, safeFetch, type EnrichmentResult, type SiteEnricher } from "./index";

const ENDPOINT = "https://solar.googleapis.com/v1/buildingInsights:findClosest";
const cache = new LRUCache<CandidateSite["google_solar"]>(500);

/**
 * Module-level lifetime counter — intentionally not reset on a daily timer
 * (matches the spec: "cap at 100 calls per server lifetime by default,
 * configurable via GOOGLE_SOLAR_DAILY_CAP"). The env var name is preserved
 * for compatibility with the deployment secret.
 */
let callCount = 0;
function cap(): number {
  const envCap = Number(process.env.GOOGLE_SOLAR_DAILY_CAP ?? "");
  return Number.isFinite(envCap) && envCap > 0 ? envCap : 100;
}

export const googleSolarEnricher: SiteEnricher = {
  name: "google_solar",
  async enrich(site: CandidateSite, signal: AbortSignal): Promise<EnrichmentResult> {
    const start = Date.now();
    const key = process.env.GOOGLE_SOLAR_API_KEY?.trim();
    if (!key) {
      return {
        patch: {},
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: "skipped",
          latency_ms: 0,
          note: "no key configured",
        },
      };
    }

    const cached = cache.get(site.lat, site.lng, "gsolar");
    if (cached) {
      return {
        patch: { google_solar: cached },
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: "ok",
          latency_ms: 0,
          note: "cache hit",
        },
      };
    }

    if (callCount >= cap()) {
      return {
        patch: {},
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: "skipped",
          latency_ms: 0,
          note: "daily cap reached",
        },
      };
    }

    callCount += 1;
    const url = `${ENDPOINT}?location.latitude=${encodeURIComponent(
      String(site.lat)
    )}&location.longitude=${encodeURIComponent(String(site.lng))}&requiredQuality=LOW&key=${encodeURIComponent(key)}`;

    const res = await safeFetch(url, { timeoutMs: 2500 }, signal);
    const latency_ms = Date.now() - start;
    if (!res) {
      return {
        patch: {},
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: signal.aborted ? "timeout" : "error",
          latency_ms,
          note: "network error",
        },
      };
    }
    if (res.status === 404) {
      const val = { available: false } as const;
      cache.set(site.lat, site.lng, val, "gsolar");
      return {
        patch: { google_solar: val },
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: "skipped",
          latency_ms,
          note: "not in Google coverage",
        },
      };
    }
    if (!res.ok) {
      return {
        patch: {},
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: "error",
          latency_ms,
          note: `HTTP ${res.status}`,
        },
      };
    }

    try {
      const data = (await res.json()) as {
        solarPotential?: {
          maxArrayAreaMeters2?: number;
          maxSunshineHoursPerYear?: number;
          carbonOffsetFactorKgPerMwh?: number;
        };
      };
      const sp = data.solarPotential ?? {};
      const val = {
        max_array_m2: typeof sp.maxArrayAreaMeters2 === "number" ? sp.maxArrayAreaMeters2 : null,
        sunshine_hours_yr:
          typeof sp.maxSunshineHoursPerYear === "number" ? sp.maxSunshineHoursPerYear : null,
        carbon_offset_kg_per_mwh:
          typeof sp.carbonOffsetFactorKgPerMwh === "number" ? sp.carbonOffsetFactorKgPerMwh : null,
        available: true,
      };
      cache.set(site.lat, site.lng, val, "gsolar");
      return {
        patch: { google_solar: val },
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: "ok",
          latency_ms,
          note: "ok",
        },
      };
    } catch {
      return {
        patch: {},
        provenance: {
          source: "google_solar",
          at: nowIso(),
          status: "error",
          latency_ms,
          note: "parse error",
        },
      };
    }
  },
};
