import type { QueryablePool } from "@/lib/postgres";
import { recordImportStart, recordImportComplete, recordImportError } from "./import-utils";

/** Square meters per acre (exact conversion factor). */
const SQMETERS_PER_ACRE = 4046.86;

export interface CountyParcelConfig {
  dataset: string;
  stateCode: string;
  countyFips: string;
  arcgisUrl: string;
  ownerType?: string;
  maxFeatures?: number;
  minAcres?: number;
}

const COUNTY_CONFIGS: CountyParcelConfig[] = [
  {
    dataset: "maricopa_county_az",
    stateCode: "AZ",
    countyFips: "04013",
    arcgisUrl: "https://gisrest.maricopa.gov/arcgis/rest/services/Assessor/PublicParcels/MapServer/0/query",
    ownerType: "private",
    maxFeatures: 100_000,
    minAcres: 10,
  },
  {
    dataset: "pinal_county_az",
    stateCode: "AZ",
    countyFips: "04021",
    arcgisUrl: "https://gis.pinal.gov/arcgis/rest/services/Parcels/MapServer/0/query",
    ownerType: "private",
    maxFeatures: 100_000,
    minAcres: 10,
  },
  {
    dataset: "yuma_county_az",
    stateCode: "AZ",
    countyFips: "04027",
    arcgisUrl: "https://maps.yumacountyaz.gov/arcgis/rest/services/Parcels/MapServer/0/query",
    ownerType: "private",
    maxFeatures: 100_000,
    minAcres: 10,
  },
];

export async function importCountyParcels(
  pool: QueryablePool,
  countyDataset?: string
): Promise<Record<string, number>> {
  const configs = countyDataset
    ? COUNTY_CONFIGS.filter((c) => c.dataset === countyDataset)
    : COUNTY_CONFIGS;

  const results: Record<string, number> = {};

  for (const config of configs) {
    results[config.dataset] = await importSingleCounty(pool, config);
  }

  return results;
}

async function importSingleCounty(
  pool: QueryablePool,
  config: CountyParcelConfig
): Promise<number> {
  const importId = await recordImportStart(pool, config.dataset, config.arcgisUrl);
  let totalRows = 0;

  try {
    let offset = 0;
    const pageSize = 1000;
    const maxFeatures = config.maxFeatures ?? 100_000;

    while (totalRows < maxFeatures) {
      const whereClause = config.minAcres
        ? `Shape_Area >= ${config.minAcres * SQMETERS_PER_ACRE}`
        : "1=1";

      const params = new URLSearchParams({
        where: whereClause,
        outFields: "OBJECTID,APN,OWNER_NAME,LAND_USE_CODE",
        outSR: "4326",
        f: "geojson",
        resultOffset: String(offset),
        resultRecordCount: String(Math.min(pageSize, maxFeatures - totalRows)),
      });

      let res: Response;
      try {
        res = await fetch(`${config.arcgisUrl}?${params}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) break;
      } catch {
        break;
      }

      const fc = (await res.json()) as {
        features?: Array<{
          geometry: unknown;
          properties: Record<string, unknown>;
        }>;
        error?: { message: string };
      };

      if (fc.error || !fc.features || fc.features.length === 0) break;

      for (const feat of fc.features) {
        if (!feat.geometry) continue;
        const geomJson = JSON.stringify(feat.geometry);
        const sourceId = String(feat.properties.OBJECTID ?? `${config.dataset}_${totalRows}`);
        const apn = typeof feat.properties.APN === "string" ? feat.properties.APN : null;
        const ownerName = typeof feat.properties.OWNER_NAME === "string" ? feat.properties.OWNER_NAME : null;
        const landUseCode = typeof feat.properties.LAND_USE_CODE === "string" ? feat.properties.LAND_USE_CODE : null;

        try {
          await pool.query(
            `INSERT INTO parcels (apn, source, source_id, state_code, county_fips, owner_type, owner_name, land_use_code, geom, centroid, bbox, imported_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               ST_Multi(ST_GeomFromGeoJSON($9)),
               ST_Centroid(ST_GeomFromGeoJSON($9)),
               ST_Envelope(ST_GeomFromGeoJSON($9)),
               NOW())
             ON CONFLICT (source, source_id) DO UPDATE
               SET apn = EXCLUDED.apn,
                   geom = EXCLUDED.geom,
                   centroid = EXCLUDED.centroid,
                   bbox = EXCLUDED.bbox,
                   imported_at = NOW()`,
            [apn, config.dataset, sourceId, config.stateCode, config.countyFips, config.ownerType ?? "private", ownerName, landUseCode, geomJson]
          );
          totalRows++;
        } catch {
          // Skip individual parcel failures
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
