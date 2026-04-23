/**
 * Tier 1 free-enrichment shared contract.
 *
 * Each enricher implements `SiteEnricher.enrich()` and returns a `patch` to
 * apply to the candidate site plus a `provenance` record. Enrichers never
 * throw — every failure path yields `status: "error" | "timeout" | "skipped"`.
 */

import type { CandidateSite } from "@/types/domain";

export interface EnrichmentResult {
  /** partial patch to apply to the site */
  patch: Partial<CandidateSite>;
  /** for audit/UI display — what did this enricher contribute? */
  provenance: {
    source: string;
    at: string;
    status: "ok" | "timeout" | "error" | "skipped";
    latency_ms: number;
    note?: string;
  };
}

export interface SiteEnricher {
  name: string;
  enrich(site: CandidateSite, signal: AbortSignal): Promise<EnrichmentResult>;
}

/** Small LRU keyed by `lat,lng` rounded to 4 decimals (~11 m). */
export class LRUCache<V> {
  private map = new Map<string, { value: V; at: number }>();
  constructor(private capacity = 500, private ttlMs = 30 * 24 * 3600 * 1000) {}
  private keyFor(lat: number, lng: number, extra = ""): string {
    return `${lat.toFixed(4)},${lng.toFixed(4)}${extra ? `|${extra}` : ""}`;
  }
  get(lat: number, lng: number, extra = ""): V | null {
    const key = this.keyFor(lat, lng, extra);
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    // bump recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }
  set(lat: number, lng: number, value: V, extra = ""): void {
    const key = this.keyFor(lat, lng, extra);
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, at: Date.now() });
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (!oldest) break;
      this.map.delete(oldest);
    }
  }
}

/** Round-trip helper for abortable fetches with a per-call timeout. */
export async function safeFetch(
  url: string,
  init: (RequestInit & { timeoutMs?: number }) | undefined,
  outerSignal: AbortSignal
): Promise<Response | null> {
  const timeoutMs = init?.timeoutMs ?? 2500;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  outerSignal.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onAbort);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
