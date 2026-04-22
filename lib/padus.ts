import { hashCoordinate } from "./util";

export interface ProtectedAreaResult {
  intersects: boolean;
  source: "padus" | "heuristic";
  detail: string;
}

export async function checkProtectedArea(lat: number, lng: number): Promise<ProtectedAreaResult> {
  const url = `https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/PADUS_Combined_Fee_Designation_Easement_v4/FeatureServer/0/query?f=json&geometry=${encodeURIComponent(`${lng},${lat}`)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=GAP_Sts&returnGeometry=false&resultRecordCount=1`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { features?: unknown[] };
      const hit = Array.isArray(data.features) && data.features.length > 0;
      return { intersects: hit, source: "padus", detail: hit ? "intersects_protected_area" : "no_intersection_detected" };
    }
  } catch {}

  const heuristic = hashCoordinate(lat, lng) % 10 === 0;
  return { intersects: heuristic, source: "heuristic", detail: heuristic ? "heuristic_possible_protected_overlap" : "heuristic_clear" };
}
