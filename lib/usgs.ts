import { hashCoordinate } from "./util";

export interface TerrainResult {
  elevation_m: number | null;
  slope_percent: number | null;
  source: "usgs" | "heuristic";
}

export async function getElevation(lat: number, lng: number): Promise<number | null> {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}&units=Meters&wkid=4326&includeDate=False`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { value?: number };
    return typeof data.value === "number" ? data.value : null;
  } catch {
    return null;
  }
}

export async function getSlopeEstimate(lat: number, lng: number): Promise<TerrainResult> {
  const center = await getElevation(lat, lng);
  if (center === null) {
    const pseudo = (hashCoordinate(lat, lng) % 45) / 10;
    return { elevation_m: null, slope_percent: pseudo, source: "heuristic" };
  }

  const d = 0.02;
  const samples = await Promise.all([
    getElevation(lat + d, lng),
    getElevation(lat - d, lng),
    getElevation(lat, lng + d),
    getElevation(lat, lng - d),
  ]);
  const deltas = samples.filter((v): v is number => typeof v === "number").map((v) => Math.abs(v - center));
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const slopePercent = Math.max(0, Math.min(25, avgDelta / 20));
  return { elevation_m: center, slope_percent: Number(slopePercent.toFixed(2)), source: "usgs" };
}
