import type { QueryablePool } from "@/lib/postgres";
import { getPostGISPool } from "@/lib/postgis";
import type { ParcelSource } from "./parcel-source-registry";

export function normalizeApn(apn: string): string {
  return apn.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function computeSourcePriority(source: Pick<ParcelSource, "source_type" | "priority">): number {
  if (typeof source.priority === "number") return source.priority;
  switch (source.source_type) {
    case "county_parcels":
      return 100;
    case "statewide_parcels":
      return 90;
    case "city_parcels":
      return 80;
    case "state_trust_parcels":
      return 70;
    case "public_land":
      return 60;
    case "plss":
      return 30;
    case "pseudo_grid":
    default:
      return 10;
  }
}

function determineDedupeReason(candidate: {
  apn_match: number;
  geom_hash_match: number;
  overlap_ratio: number;
}): string {
  if (candidate.apn_match === 1) return "apn_match";
  if (candidate.geom_hash_match === 1) return "geom_hash_match";
  if (candidate.overlap_ratio >= 0.98) return "exact_duplicate";
  return "likely_duplicate";
}

function shouldReplaceBestSource(current: {
  priority: number;
  is_true_parcel: boolean;
  area_acres: number | null;
  source_type: string | null;
}, incoming: {
  priority: number;
  is_true_parcel: boolean;
  area_acres: number | null;
  source_type: string;
}): boolean {
  if (current.is_true_parcel && !incoming.is_true_parcel) return false;
  if (!current.is_true_parcel && incoming.is_true_parcel) return true;
  if (incoming.priority !== current.priority) return incoming.priority > current.priority;
  if (incoming.source_type === "county_parcels" && current.source_type === "statewide_parcels") {
    // Treat county-vs-statewide parcels with roughly matching footprint (within 5%)
    // as the same parcel and prefer the county geometry/metadata as the higher
    // authority source.
    const currentArea = current.area_acres ?? 0;
    const incomingArea = incoming.area_acres ?? 0;
    return Math.abs(currentArea - incomingArea) <= Math.max(1, currentArea * 0.05);
  }
  if (current.source_type === "plss" && incoming.source_type !== "plss") return true;
  return false;
}

async function resolvePool(pool?: QueryablePool | null): Promise<QueryablePool> {
  const resolved = pool ?? (await getPostGISPool());
  if (!resolved) throw new Error("PostGIS database is required for parcel unification");
  return resolved;
}

export async function unifyParcelSources(options: {
  pool?: QueryablePool | null;
  stateCode?: string;
} = {}): Promise<{ processed: number; unified: number; conflicts: number }> {
  const pool = await resolvePool(options.pool);
  const params: unknown[] = [];
  const stateClause = options.stateCode ? `WHERE r.state_code = $1` : "";
  if (options.stateCode) params.push(options.stateCode);

  await pool.query(`DELETE FROM parcel_source_links`);
  await pool.query(`DELETE FROM parcel_duplicate_groups`);
  await pool.query(`DELETE FROM parcels_unified`);

  const raw = (await pool.query(
    `SELECT
       r.id,
       r.source_id,
       r.source_type,
       r.source_name,
       r.state_code,
       r.county,
       r.external_id,
       r.apn,
       r.owner_name,
       r.is_true_parcel,
       r.is_public_land,
       r.area_acres,
       r.geom_hash,
       ST_AsGeoJSON(r.geom) AS geom_json,
       s.priority,
       s.source_type AS registry_source_type
     FROM raw_parcel_features r
     LEFT JOIN parcel_sources s ON s.id = r.source_id
     ${stateClause}
     ORDER BY COALESCE(s.priority, 0) DESC, r.is_true_parcel DESC, r.id ASC`,
    params
  )) as {
    rows: Array<{
      id: number;
      source_id: string;
      source_type: string;
      source_name: string | null;
      state_code: string | null;
      county: string | null;
      external_id: string | null;
      apn: string | null;
      owner_name: string | null;
      is_true_parcel: boolean;
      is_public_land: boolean | null;
      area_acres: number | null;
      geom_hash: string | null;
      geom_json: string;
      priority: number | null;
      registry_source_type: string | null;
    }>;
  };

  let conflicts = 0;

  for (const feature of raw.rows) {
    const normalizedApn = feature.apn ? normalizeApn(feature.apn) : null;
    const duplicate = (await pool.query(
      `WITH candidates AS (
         SELECT
           u.id,
           u.best_source_id,
           u.best_source_type,
           u.is_true_parcel,
           u.area_acres,
           ps.priority,
           CASE
             WHEN $4 IS NOT NULL
              AND u.state_code = $1
              AND COALESCE(u.county, '') = COALESCE($2, '')
              AND regexp_replace(COALESCE(u.best_apn, ''), '[^A-Z0-9]', '', 'g') = $4
             THEN 1 ELSE 0
           END AS apn_match,
           CASE
             WHEN $5 IS NOT NULL
              AND md5(ST_AsBinary(ST_SnapToGrid(u.geom, 0.000001))::text) = $5
             THEN 1 ELSE 0
           END AS geom_hash_match,
           COALESCE(
             ST_Area(ST_Intersection(ST_GeomFromGeoJSON($3), u.geom)::geography)
             / NULLIF(LEAST(ST_Area(ST_GeomFromGeoJSON($3)::geography), ST_Area(u.geom::geography)), 0),
             0
           ) AS overlap_ratio
         FROM parcels_unified u
         LEFT JOIN parcel_sources ps ON ps.id = u.best_source_id
         WHERE u.state_code IS NOT DISTINCT FROM $1
           AND ST_Intersects(u.geom, ST_GeomFromGeoJSON($3))
       )
       SELECT *
         FROM candidates
        WHERE apn_match = 1 OR geom_hash_match = 1 OR overlap_ratio >= 0.5
        ORDER BY apn_match DESC, geom_hash_match DESC, overlap_ratio DESC, COALESCE(priority, 0) DESC
        LIMIT 1`,
      [feature.state_code, feature.county, feature.geom_json, normalizedApn, feature.geom_hash]
    )) as {
      rows: Array<{
        id: number;
        best_source_id: string | null;
        best_source_type: string | null;
        is_true_parcel: boolean;
        area_acres: number | null;
        priority: number | null;
        apn_match: number;
        geom_hash_match: number;
        overlap_ratio: number;
      }>;
    };

    const candidate = duplicate.rows[0];
    if (!candidate) {
      const created = (await pool.query(
        `INSERT INTO parcels_unified (
           unified_key, state_code, county, best_apn, best_external_id, best_source_id,
           best_source_type, best_source_name, is_true_parcel, is_public_land,
           confidence_score, source_count, geom, centroid, bbox, area_acres, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, 1, ST_GeomFromGeoJSON($12), ST_PointOnSurface(ST_GeomFromGeoJSON($12)),
           ST_Envelope(ST_GeomFromGeoJSON($12)), $13, NOW(), NOW()
         ) RETURNING id`,
        [
          `${feature.state_code ?? "NA"}:${feature.source_id}:${feature.id}`,
          feature.state_code,
          feature.county,
          feature.apn,
          feature.external_id,
          feature.source_id,
          feature.registry_source_type ?? feature.source_type,
          feature.source_name,
          feature.is_true_parcel,
          feature.is_public_land,
          feature.is_true_parcel ? 0.95 : 0.55,
          feature.geom_json,
          feature.area_acres,
        ]
      )) as { rows: Array<{ id: number }> };
      const unifiedId = created.rows[0]?.id;
      if (unifiedId) {
        await pool.query(
          `INSERT INTO parcel_source_links (unified_parcel_id, raw_feature_id, source_id, source_priority, overlap_ratio, dedupe_reason)
           VALUES ($1, $2, $3, $4, NULL, 'new_parcel')`,
          [unifiedId, feature.id, feature.source_id, feature.priority ?? 0]
        );
      }
      continue;
    }

    if (candidate.overlap_ratio >= 0.5 && candidate.overlap_ratio < 0.85 && candidate.apn_match !== 1) {
      conflicts++;
      await pool.query(
        `INSERT INTO parcel_duplicate_groups (group_key, status, reason)
         VALUES ($1, 'conflict', $2)`,
        [
          `${feature.state_code ?? "NA"}:${feature.id}:${candidate.id}`,
          `overlap_conflict:${candidate.overlap_ratio.toFixed(4)}`,
        ]
      );

      const created = (await pool.query(
        `INSERT INTO parcels_unified (
           unified_key, state_code, county, best_apn, best_external_id, best_source_id,
           best_source_type, best_source_name, is_true_parcel, is_public_land,
           confidence_score, source_count, geom, centroid, bbox, area_acres, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           0.4, 1, ST_GeomFromGeoJSON($11), ST_PointOnSurface(ST_GeomFromGeoJSON($11)),
           ST_Envelope(ST_GeomFromGeoJSON($11)), $12, NOW(), NOW()
         ) RETURNING id`,
        [
          `${feature.state_code ?? "NA"}:${feature.source_id}:${feature.id}`,
          feature.state_code,
          feature.county,
          feature.apn,
          feature.external_id,
          feature.source_id,
          feature.registry_source_type ?? feature.source_type,
          feature.source_name,
          feature.is_true_parcel,
          feature.is_public_land,
          feature.geom_json,
          feature.area_acres,
        ]
      )) as { rows: Array<{ id: number }> };
      const unifiedId = created.rows[0]?.id;
      if (unifiedId) {
        await pool.query(
          `INSERT INTO parcel_source_links (unified_parcel_id, raw_feature_id, source_id, source_priority, overlap_ratio, dedupe_reason)
           VALUES ($1, $2, $3, $4, NULL, 'overlapping_conflict')`,
          [unifiedId, feature.id, feature.source_id, feature.priority ?? 0]
        );
      }
      continue;
    }

    await pool.query(
      `INSERT INTO parcel_source_links (unified_parcel_id, raw_feature_id, source_id, source_priority, overlap_ratio, dedupe_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        candidate.id,
        feature.id,
        feature.source_id,
        feature.priority ?? 0,
        candidate.overlap_ratio,
        determineDedupeReason(candidate),
      ]
    );

    const incomingPriority = feature.priority ?? 0;
    const currentPriority = candidate.priority ?? 0;
    const replaceBest = shouldReplaceBestSource(
      {
        priority: currentPriority,
        is_true_parcel: candidate.is_true_parcel,
        area_acres: candidate.area_acres,
        source_type: candidate.best_source_type,
      },
      {
        priority: incomingPriority,
        is_true_parcel: feature.is_true_parcel,
        area_acres: feature.area_acres,
        source_type: feature.registry_source_type ?? feature.source_type,
      }
    );

    await pool.query(
      `UPDATE parcels_unified
          SET source_count = COALESCE(source_count, 0) + 1,
              confidence_score = GREATEST(confidence_score, CASE WHEN $2 >= 0.98 THEN 0.99 WHEN $2 >= 0.85 THEN 0.9 ELSE confidence_score END),
              updated_at = NOW(),
              best_apn = CASE WHEN $3 THEN $4 ELSE best_apn END,
              best_external_id = CASE WHEN $3 THEN $5 ELSE best_external_id END,
              best_source_id = CASE WHEN $3 THEN $6 ELSE best_source_id END,
              best_source_type = CASE WHEN $3 THEN $7 ELSE best_source_type END,
              best_source_name = CASE WHEN $3 THEN $8 ELSE best_source_name END,
              is_true_parcel = CASE WHEN $3 THEN $9 ELSE is_true_parcel END,
              is_public_land = CASE WHEN $3 THEN $10 ELSE is_public_land END,
              geom = CASE WHEN $3 THEN ST_GeomFromGeoJSON($11) ELSE geom END,
              centroid = CASE WHEN $3 THEN ST_PointOnSurface(ST_GeomFromGeoJSON($11)) ELSE centroid END,
              bbox = CASE WHEN $3 THEN ST_Envelope(ST_GeomFromGeoJSON($11)) ELSE bbox END,
              area_acres = CASE WHEN $3 THEN $12 ELSE area_acres END
        WHERE id = $1`,
      [
        candidate.id,
        candidate.overlap_ratio,
        replaceBest,
        feature.apn,
        feature.external_id,
        feature.source_id,
        feature.registry_source_type ?? feature.source_type,
        feature.source_name,
        feature.is_true_parcel,
        feature.is_public_land,
        feature.geom_json,
        feature.area_acres,
      ]
    );
  }

  const unifiedCount = (await pool.query(`SELECT COUNT(*)::bigint::text AS count FROM parcels_unified`)) as {
    rows: Array<{ count: string }>;
  };

  return {
    processed: raw.rows.length,
    unified: Number(unifiedCount.rows[0]?.count ?? 0),
    conflicts,
  };
}
