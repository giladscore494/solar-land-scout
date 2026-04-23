import type { QueryablePool } from "@/lib/postgres";
import { recordImportStart, recordImportComplete, recordImportError } from "./import-utils";

const FEMA_NFHL_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

// Arizona bbox
const AZ_BBOX = "-114.82,31.33,-109.04,37.00";

export async function importFemaFloodAz(pool: QueryablePool): Promise<number> {
  const importId = await recordImportStart(pool, "fema_flood_az", FEMA_NFHL_URL);
  let totalRows = 0;

  try {
    let offset = 0;
    const pageSize = 500;

    while (true) {
      const params = new URLSearchParams({
        where: "STATE_ABBR='AZ'",
        geometry: AZ_BBOX,
        geometryType: "esriGeometryEnvelope",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "OBJECTID,FLD_ZONE",
        outSR: "4326",
        f: "geojson",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
      });

      const res = await fetch(`${FEMA_NFHL_URL}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`FEMA NFHL API returned ${res.status}`);

      const fc = (await res.json()) as {
        features?: Array<{
          geometry: unknown;
          properties: Record<string, unknown>;
        }>;
      };

      if (!fc.features || fc.features.length === 0) break;

      for (const feat of fc.features) {
        if (!feat.geometry) continue;
        const geomJson = JSON.stringify(feat.geometry);
        const sourceId = String(feat.properties.OBJECTID ?? `fema_az_${totalRows}`);
        const floodZone = typeof feat.properties.FLD_ZONE === "string" ? feat.properties.FLD_ZONE : null;
        const sfha = floodZone ? (floodZone.startsWith("A") || floodZone.startsWith("V")) : false;

        try {
          await pool.query(
            `INSERT INTO flood_zones (source_id, flood_zone, sfha, geom, imported_at)
             VALUES ($1, $2, $3, ST_Multi(ST_GeomFromGeoJSON($4)), NOW())
             ON CONFLICT (source_id) DO UPDATE
               SET flood_zone = EXCLUDED.flood_zone,
                   sfha = EXCLUDED.sfha,
                   geom = EXCLUDED.geom,
                   imported_at = NOW()`,
            [sourceId, floodZone, sfha, geomJson]
          );
          totalRows++;
        } catch {
          // Skip individual feature failures
        }
      }

      if (fc.features.length < pageSize) break;
      offset += pageSize;
    }

    await recordImportComplete(pool, importId, totalRows);
    return totalRows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordImportError(pool, importId, msg);
    throw err;
  }
}
