/**
 * NASA POWER — annual GHI climatology. Used as a fallback for NREL and as a
 * cross-check when both sources are available.
 */

import type { CandidateSite } from "@/types/domain";
import {
  LRUCache,
  nowIso,
  safeFetch,
  type EnrichmentResult,
  type SiteEnricher,
} from "./index";

const ENDPOINT = "https://power.larc.nasa.gov/api/temporal/climatology/point";
const cache = new LRUCache<number>(1000);

export const nasaPowerEnricher: SiteEnricher = {
  name: "nasa_power",
  async enrich(site: CandidateSite, signal: AbortSignal): Promise<EnrichmentResult> {
    const start = Date.now();

    const haveNrel = !!process.env.NREL_API_KEY?.trim();
    const currentGhi = site.solar_resource_value;
    const needFallback = !haveNrel || !currentGhi || currentGhi <= 0;

    const cached = cache.get(site.lat, site.lng, "nasa");
    let ghi: number | null = cached;

    if (ghi === null) {
      const url = `${ENDPOINT}?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${encodeURIComponent(
        String(site.lng)
      )}&latitude=${encodeURIComponent(String(site.lat))}&format=JSON`;
      const res = await safeFetch(url, { timeoutMs: 2500 }, signal);
      const latency_ms = Date.now() - start;
      if (!res || !res.ok) {
        return {
          patch: {},
          provenance: {
            source: "nasa_power",
            at: nowIso(),
            status: signal.aborted ? "timeout" : "error",
            latency_ms,
            note: res ? `HTTP ${res.status}` : "network error",
          },
        };
      }
      try {
        const data = (await res.json()) as {
          properties?: { parameter?: { ALLSKY_SFC_SW_DWN?: { ANN?: number } } };
        };
        const ann = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN;
        if (typeof ann !== "number" || !Number.isFinite(ann)) {
          return {
            patch: {},
            provenance: {
              source: "nasa_power",
              at: nowIso(),
              status: "error",
              latency_ms,
              note: "no ANN value",
            },
          };
        }
        ghi = ann;
        cache.set(site.lat, site.lng, ghi, "nasa");
      } catch {
        return {
          patch: {},
          provenance: {
            source: "nasa_power",
            at: nowIso(),
            status: "error",
            latency_ms,
            note: "parse error",
          },
        };
      }
    }

    const latency_ms = Date.now() - start;

    // Validation log when both sources exist — debug only.
    if (!needFallback && typeof currentGhi === "number" && ghi !== null) {
      const delta = Math.abs(currentGhi - ghi);
      if (delta > 1.5) {
        // eslint-disable-next-line no-console
        console.debug(
          `[nasa_power] delta ${delta.toFixed(2)} kWh/m²/day vs NREL at ${site.id}`
        );
      }
    }

    if (needFallback && ghi !== null) {
      return {
        patch: { solar_resource_value: Number(ghi.toFixed(2)) },
        provenance: {
          source: "nasa_power",
          at: nowIso(),
          status: "ok",
          latency_ms,
          note: `fallback GHI=${ghi.toFixed(2)}`,
        },
      };
    }

    return {
      patch: {},
      provenance: {
        source: "nasa_power",
        at: nowIso(),
        status: "ok",
        latency_ms,
        note: `validation GHI=${ghi?.toFixed(2) ?? "n/a"}`,
      },
    };
  },
};
