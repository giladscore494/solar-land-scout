import type { QueryablePool } from "@/lib/postgres";
import { recordImportStart, recordImportComplete, recordImportError } from "./import-utils";

const BLM_SMA_AZ_URL =
  "https://gis.blm.gov/arcgis/rest/services/admin_boundaries/BLM_Natl_SMA_LimitedScale/MapServer/1/query";

export async function importBlmSmaAz(pool: QueryablePool): Promise<number> {
  const importId = await recordImportStart(pool, "blm_sma_az", BLM_SMA_AZ_URL);
  let totalRows = 0;

  try {
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const params = new URLSearchParams({
        where: "ADMIN_ST='AZ'",
        outFields: "OBJECTID,ADMIN_ST,BLM_ORG_CD,SHAPE_Area",
        outSR: "4326",
        f: "geojson",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
      });

      const res = await fetch(`${BLM_SMA_AZ_URL}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`BLM SMA API returned ${res.status}`);

      const fc = (await res.json()) as {
        features?: Array<{
          type: string;
          geometry: unknown;
          properties: Record<string, unknown>;
        }>;
      };

      if (!fc.features || fc.features.length === 0) break;

      for (const feat of fc.features) {
        if (!feat.geometry) continue;
        const geomJson = JSON.stringify(feat.geometry);
        const sourceId = String(feat.properties.OBJECTID ?? `blm_az_${offset}_${totalRows}`);

        await pool.query(
          `INSERT INTO parcels (apn, source, source_id, state_code, county_fips, owner_type, geom, centroid, bbox, imported_at)
           VALUES (NULL, 'blm_sma_az', $1, 'AZ', NULL, 'federal_blm',
             ST_Multi(ST_GeomFromGeoJSON($2)),
             ST_Centroid(ST_GeomFromGeoJSON($2)),
             ST_Envelope(ST_GeomFromGeoJSON($2)),
             NOW())
           ON CONFLICT (source, source_id) DO UPDATE
             SET geom = EXCLUDED.geom,
                 centroid = EXCLUDED.centroid,
                 bbox = EXCLUDED.bbox,
                 imported_at = NOW()`,
          [sourceId, geomJson]
        );
        totalRows++;
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
