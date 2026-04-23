import type { QueryablePool } from "@/lib/postgres";
import { recordImportStart, recordImportComplete, recordImportError } from "./import-utils";

// PAD-US 4.0 via ArcGIS REST — Arizona bounding box filter
const PADUS_URL =
  "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Protected_Areas_Database_of_the_United_States_PAD_US_4_0/FeatureServer/0/query";

// Arizona bbox
const AZ_BBOX = "-114.82,31.33,-109.04,37.00";

export async function importPadusAz(pool: QueryablePool): Promise<number> {
  const importId = await recordImportStart(pool, "padus_az", PADUS_URL);
  let totalRows = 0;

  try {
    let offset = 0;
    const pageSize = 500;

    while (true) {
      const params = new URLSearchParams({
        where: "State_Nm='AZ'",
        geometry: AZ_BBOX,
        geometryType: "esriGeometryEnvelope",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "OBJECTID,Unit_Nm,Designation,Mang_Name",
        outSR: "4326",
        f: "geojson",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
      });

      const res = await fetch(`${PADUS_URL}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`PAD-US API returned ${res.status}`);

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
        const sourceId = String(feat.properties.OBJECTID ?? `padus_az_${totalRows}`);
        const name = typeof feat.properties.Unit_Nm === "string" ? feat.properties.Unit_Nm : null;
        const designation = typeof feat.properties.Designation === "string" ? feat.properties.Designation : null;
        const agency = typeof feat.properties.Mang_Name === "string" ? feat.properties.Mang_Name : null;

        try {
          await pool.query(
            `INSERT INTO protected_areas (source, source_id, name, designation, managing_agency, geom, imported_at)
             VALUES ('padus', $1, $2, $3, $4,
               ST_Multi(ST_GeomFromGeoJSON($5)),
               NOW())
             ON CONFLICT (source, source_id) DO UPDATE
               SET name = EXCLUDED.name,
                   designation = EXCLUDED.designation,
                   managing_agency = EXCLUDED.managing_agency,
                   geom = EXCLUDED.geom,
                   imported_at = NOW()`,
            [sourceId, name, designation, agency, geomJson]
          );
          totalRows++;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[padus-protected] Feature insert failed:", err);
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
