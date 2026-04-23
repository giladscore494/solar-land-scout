import type { QueryablePool } from "@/lib/postgres";
import { recordImportStart, recordImportComplete, recordImportError } from "./import-utils";

const HIFLD_TRANSMISSION_URL =
  "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0/query";

export async function importHifldTransmission(pool: QueryablePool): Promise<number> {
  const importId = await recordImportStart(pool, "hifld_transmission", HIFLD_TRANSMISSION_URL);
  let totalRows = 0;

  try {
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const params = new URLSearchParams({
        where: "VOLTAGE >= 69",
        outFields: "OBJECTID,VOLTAGE,OWNER,STATUS",
        outSR: "4326",
        f: "geojson",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
      });

      const res = await fetch(`${HIFLD_TRANSMISSION_URL}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HIFLD Transmission API returned ${res.status}`);

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
        const sourceId = String(feat.properties.OBJECTID ?? `hifld_trans_${totalRows}`);
        const voltage = typeof feat.properties.VOLTAGE === "number" ? feat.properties.VOLTAGE : null;
        const owner = typeof feat.properties.OWNER === "string" ? feat.properties.OWNER : null;
        const status = typeof feat.properties.STATUS === "string" ? feat.properties.STATUS : null;

        await pool.query(
          `INSERT INTO transmission_lines (source_id, voltage_kv, owner, status, geom, imported_at)
           VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), NOW())
           ON CONFLICT (source_id) DO UPDATE
             SET voltage_kv = EXCLUDED.voltage_kv,
                 owner = EXCLUDED.owner,
                 status = EXCLUDED.status,
                 geom = EXCLUDED.geom,
                 imported_at = NOW()`,
          [sourceId, voltage, owner, status, geomJson]
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
