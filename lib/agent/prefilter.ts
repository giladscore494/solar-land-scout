import type { GridCell } from "./grid";

export interface PrefilterResult {
  kept: GridCell[];
  dropped: Array<{ cell: GridCell; reason: "low_ghi" }>;
}

const GHI_THRESHOLD = 4.5;
const NASA_POWER_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/climatology/point";

// Simple in-process cache keyed on rounded lat/lng
const ghiCache = new Map<string, number>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

async function fetchGhi(lat: number, lng: number, signal?: AbortSignal): Promise<number | null> {
  const key = cacheKey(lat, lng);
  const cached = ghiCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const url = `${NASA_POWER_ENDPOINT}?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${encodeURIComponent(
      String(lng)
    )}&latitude=${encodeURIComponent(String(lat))}&format=JSON`;
    const res = await fetch(url, {
      signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      properties?: { parameter?: { ALLSKY_SFC_SW_DWN?: { ANN?: number } } };
    };
    const ann = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN?.ANN;
    if (typeof ann === "number" && Number.isFinite(ann)) {
      ghiCache.set(key, ann);
      return ann;
    }
    return null;
  } catch {
    return null;
  }
}

export async function prefilterCells(
  cells: GridCell[],
  signal?: AbortSignal
): Promise<PrefilterResult> {
  const kept: GridCell[] = [];
  const dropped: Array<{ cell: GridCell; reason: "low_ghi" }> = [];

  // Process in batches of 50, but with aggressive caching (1-degree grid)
  // so nearby cells reuse cached results
  const BATCH = 50;

  for (let i = 0; i < cells.length; i += BATCH) {
    if (signal?.aborted) break;
    const batch = cells.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (cell) => {
        const ghi = await fetchGhi(cell.centerLat, cell.centerLng, signal);
        if (ghi !== null && ghi < GHI_THRESHOLD) {
          dropped.push({ cell, reason: "low_ghi" });
        } else {
          // If NASA POWER unavailable (null), keep the cell
          kept.push(cell);
        }
      })
    );
  }

  return { kept, dropped };
}
