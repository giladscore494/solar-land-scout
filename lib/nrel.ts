/**
 * NREL integration layer.
 *
 * For v1 we keep this intentionally lightweight: a single "solar resource at
 * a point" lookup against NREL's Solar Resource Data API. It is not required
 * by any UI flow (seed data already includes GHI values) but is wired into
 * the /api/sites pipeline as optional enrichment and can be expanded later
 * without touching the rest of the app.
 *
 * Docs: https://developer.nrel.gov/docs/solar/solar-resource-v1/
 */

export interface NrelSolarResource {
  /** Global Horizontal Irradiance (annual avg, kWh/m²/day). */
  avg_ghi: number | null;
  /** Direct Normal Irradiance. */
  avg_dni: number | null;
  /** Latitude tilt. */
  avg_lat_tilt: number | null;
  source: "nrel" | "unavailable";
}

const ENDPOINT = "https://developer.nrel.gov/api/solar/solar_resource/v1.json";

function readApiKey(): string | null {
  const key = process.env.NREL_API_KEY;
  if (!key || key.trim() === "") return null;
  return key.trim();
}

/**
 * Fetch NREL solar resource values for a lat/lng. Returns an "unavailable"
 * stub (never throws) so callers can degrade gracefully without noisy errors.
 */
export async function fetchSolarResource(
  lat: number,
  lng: number,
  timeoutMs = 4000
): Promise<NrelSolarResource> {
  const unavailable: NrelSolarResource = {
    avg_ghi: null,
    avg_dni: null,
    avg_lat_tilt: null,
    source: "unavailable",
  };

  const key = readApiKey();
  if (!key) return unavailable;

  const url = `${ENDPOINT}?api_key=${encodeURIComponent(
    key
  )}&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(
    String(lng)
  )}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return unavailable;
    const data = (await res.json()) as {
      outputs?: {
        avg_ghi?: { annual?: number };
        avg_dni?: { annual?: number };
        avg_lat_tilt?: { annual?: number };
      };
    };
    const out = data.outputs ?? {};
    return {
      avg_ghi: num(out.avg_ghi?.annual),
      avg_dni: num(out.avg_dni?.annual),
      avg_lat_tilt: num(out.avg_lat_tilt?.annual),
      source: "nrel",
    };
  } catch {
    return unavailable;
  } finally {
    clearTimeout(t);
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
