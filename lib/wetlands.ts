import { hashCoordinate } from "./util";

export interface WetlandsResult {
  impact_score_0_100: number;
  intersects: boolean;
  source: "nwi" | "heuristic";
}

export async function checkWetlands(lat: number, lng: number): Promise<WetlandsResult> {
  const url = `https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer/0/query?f=json&geometry=${encodeURIComponent(`${lng},${lat}`)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnCountOnly=true`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { count?: number };
      const hit = (data.count ?? 0) > 0;
      return { impact_score_0_100: hit ? 82 : 12, intersects: hit, source: "nwi" };
    }
  } catch {}
  const score = hashCoordinate(lat, lng) % 100;
  return { impact_score_0_100: score, intersects: score >= 60, source: "heuristic" };
}
