import type { QueryablePool } from "@/lib/postgres";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import type { ParcelSource } from "./parcel-source-registry";

export function pickFirstString(properties: Record<string, unknown>, aliases: string[] = []): string | null {
  for (const key of aliases) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function pickFirstNumber(properties: Record<string, unknown>, aliases: string[] = []): number | null {
  for (const key of aliases) {
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function toMultiPolygonGeometry(geometry: Geometry | null | undefined): MultiPolygon | null {
  if (!geometry) return null;
  if (geometry.type === "MultiPolygon") return geometry;
  if (geometry.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [geometry.coordinates] } satisfies MultiPolygon;
  }
  return null;
}

export interface InsertRawFeatureInput {
  source: ParcelSource;
  importJobId: number;
  geometry: MultiPolygon;
  properties: Record<string, unknown>;
  externalId: string | null;
  apn: string | null;
  ownerName: string | null;
  county: string | null;
  stateCode: string | null;
}

export async function insertRawParcelFeature(
  pool: QueryablePool,
  input: InsertRawFeatureInput
): Promise<boolean> {
  const geomJson = JSON.stringify(input.geometry);
  const areaAcresFromProps = pickFirstNumber(input.properties, input.source.fields?.acres ?? []);
  const result = await pool.query(
    `INSERT INTO raw_parcel_features (
       source_id, import_job_id, source_type, source_name, source_url, state_code, county,
       external_id, apn, owner_name, raw_properties, is_true_parcel, is_public_land,
       geom, centroid, bbox, area_acres, geom_hash, imported_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11::jsonb, $12, $13,
       ST_CollectionExtract(ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON($14))), 3),
       ST_PointOnSurface(ST_CollectionExtract(ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON($14))), 3)),
       ST_Envelope(ST_CollectionExtract(ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON($14))), 3)),
       COALESCE($15, ST_Area(ST_CollectionExtract(ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON($14))), 3)::geography) / 4046.8564224),
       md5(ST_AsBinary(ST_SnapToGrid(ST_CollectionExtract(ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON($14))), 3), 0.000001))::text),
       NOW()
     )
     ON CONFLICT (source_id, external_id) DO UPDATE
       SET source_type = EXCLUDED.source_type,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           state_code = EXCLUDED.state_code,
           county = EXCLUDED.county,
           apn = EXCLUDED.apn,
           owner_name = EXCLUDED.owner_name,
           raw_properties = EXCLUDED.raw_properties,
           is_true_parcel = EXCLUDED.is_true_parcel,
           is_public_land = EXCLUDED.is_public_land,
           geom = EXCLUDED.geom,
           centroid = EXCLUDED.centroid,
           bbox = EXCLUDED.bbox,
           area_acres = EXCLUDED.area_acres,
           geom_hash = EXCLUDED.geom_hash,
           import_job_id = EXCLUDED.import_job_id,
           imported_at = NOW()
     RETURNING id`,
    [
      input.source.id,
      input.importJobId,
      input.source.source_type,
      input.source.name,
      input.source.url,
      input.stateCode,
      input.county,
      input.externalId,
      input.apn,
      input.ownerName,
      JSON.stringify(input.properties),
      input.source.is_true_parcel,
      input.source.is_public_land ?? null,
      geomJson,
      areaAcresFromProps,
    ]
  );
  return result.rows.length > 0;
}

export function geoJsonFeatureToProperties(feature: Feature): Record<string, unknown> {
  return typeof feature.properties === "object" && feature.properties ? feature.properties : {};
}
