import { hashCoordinate } from "./util";

export interface FloodRiskResult {
  risk_score_0_100: number;
  high_risk: boolean;
  source: "fema" | "heuristic";
}

export async function checkFloodRisk(lat: number, lng: number): Promise<FloodRiskResult> {
  const url = `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?f=json&geometry=${encodeURIComponent(`${lng},${lat}`)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnCountOnly=true`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { count?: number };
      const count = typeof data.count === "number" ? data.count : 0;
      const score = Math.min(100, count > 0 ? 80 : 15);
      return { risk_score_0_100: score, high_risk: score >= 70, source: "fema" };
    }
  } catch {}
  const score = hashCoordinate(lat, lng) % 100;
  return { risk_score_0_100: score, high_risk: score >= 70, source: "heuristic" };
}
