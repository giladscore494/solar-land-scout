import type { QueryablePool } from "@/lib/postgres";
import type { ParcelSource } from "./parcel-source-registry";

export interface ParcelImportJobRecord {
  id: number;
  source_id: string;
  status: string;
}

export interface ParcelCoverageSummary {
  state_code: string;
  raw_features_count: number;
  unified_parcels_count: number;
  true_parcels_count: number;
  plss_count: number;
  sources: Record<string, number>;
  approximate_covered_area_acres: number;
  duplicate_links_count: number;
  conflicts_count: number;
  scanner_relation: "scanner_parcels" | "parcels";
  engine_mode: "true_parcels" | "parcel_like_fallback" | "mixed" | "none";
}

async function relationExists(pool: QueryablePool, relationName: string): Promise<boolean> {
  const result = (await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [relationName])) as {
    rows: Array<{ present: boolean }>;
  };
  return result.rows[0]?.present ?? false;
}

async function countByState(
  pool: QueryablePool,
  relationName: string,
  stateCode: string
): Promise<number> {
  const safeRelationName =
    relationName === "scanner_parcels" || relationName === "parcels" ? relationName : null;
  if (!safeRelationName) {
    throw new Error(`Unsupported parcel relation: ${relationName}`);
  }
  const result = (await pool.query(`SELECT COUNT(*)::bigint::text AS count FROM ${safeRelationName} WHERE state_code = $1`, [
    stateCode,
  ])) as { rows: Array<{ count: string }> };
  return Number(result.rows[0]?.count ?? 0);
}

export async function syncParcelSource(pool: QueryablePool, source: ParcelSource): Promise<void> {
  await pool.query(
    `INSERT INTO parcel_sources (
       id, name, source_type, state_code, county, country, priority, is_true_parcel,
       is_public_land, license_note, url, access_method, enabled, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           source_type = EXCLUDED.source_type,
           state_code = EXCLUDED.state_code,
           county = EXCLUDED.county,
           country = EXCLUDED.country,
           priority = EXCLUDED.priority,
           is_true_parcel = EXCLUDED.is_true_parcel,
           is_public_land = EXCLUDED.is_public_land,
           license_note = EXCLUDED.license_note,
           url = EXCLUDED.url,
           access_method = EXCLUDED.access_method,
           enabled = EXCLUDED.enabled,
           updated_at = NOW()`,
    [
      source.id,
      source.name,
      source.source_type,
      source.state_code ?? null,
      source.county ?? null,
      source.country,
      source.priority,
      source.is_true_parcel,
      source.is_public_land ?? null,
      source.license_note,
      source.url,
      source.access_method,
      source.enabled_by_default,
    ]
  );
}

export async function startParcelImportJob(
  pool: QueryablePool,
  sourceId: string,
  metadata: Record<string, unknown> = {}
): Promise<ParcelImportJobRecord> {
  const result = (await pool.query(
    `INSERT INTO parcel_import_jobs (source_id, status, metadata)
     VALUES ($1, 'running', $2::jsonb)
     RETURNING id, source_id, status`,
    [sourceId, JSON.stringify(metadata)]
  )) as { rows: ParcelImportJobRecord[] };
  return result.rows[0] ?? { id: 0, source_id: sourceId, status: "running" };
}

export async function finishParcelImportJob(
  pool: QueryablePool,
  jobId: number,
  updates: {
    status: string;
    importedCount?: number;
    skippedCount?: number;
    failedCount?: number;
    error?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await pool.query(
    `UPDATE parcel_import_jobs
        SET status = $2,
            finished_at = NOW(),
            imported_count = COALESCE($3, imported_count),
            skipped_count = COALESCE($4, skipped_count),
            failed_count = COALESCE($5, failed_count),
            error = $6,
            metadata = COALESCE($7::jsonb, metadata)
      WHERE id = $1`,
    [
      jobId,
      updates.status,
      updates.importedCount ?? null,
      updates.skippedCount ?? null,
      updates.failedCount ?? null,
      updates.error ?? null,
      updates.metadata ? JSON.stringify(updates.metadata) : null,
    ]
  );
}

export async function detectScannerParcelRelation(
  pool: QueryablePool,
  stateCode?: string | null
): Promise<"scanner_parcels" | "parcels"> {
  const scannerExists = await relationExists(pool, "public.scanner_parcels");
  if (!scannerExists) {
    return "parcels";
  }

  if (!stateCode) {
    return "scanner_parcels";
  }

  const scannerCount = await countByState(pool, "scanner_parcels", stateCode);
  const legacyExists = await relationExists(pool, "public.parcels");
  const legacyCount = legacyExists ? await countByState(pool, "parcels", stateCode) : 0;
  return scannerCount > 0 || legacyCount === 0 ? "scanner_parcels" : "parcels";
}

export async function getParcelCoverageSummary(
  pool: QueryablePool,
  stateCode: string
): Promise<ParcelCoverageSummary> {
  const [rawExists, unifiedExists, sourceLinksExists, duplicateGroupsExists] = await Promise.all([
    relationExists(pool, "public.raw_parcel_features"),
    relationExists(pool, "public.parcels_unified"),
    relationExists(pool, "public.parcel_source_links"),
    relationExists(pool, "public.parcel_duplicate_groups"),
  ]);
  const relation = await detectScannerParcelRelation(pool, stateCode);
  const safeRawFrom = rawExists ? "raw_parcel_features" : "(SELECT NULL::text AS source_id, NULL::text AS state_code LIMIT 0) raw_parcel_features";
  const safeUnifiedFrom = unifiedExists ? "parcels_unified" : "(SELECT NULL::text AS state_code, NULL::boolean AS is_true_parcel, NULL::numeric AS area_acres, NULL::bigint AS id LIMIT 0) parcels_unified";
  const safeSourceLinksJoin = unifiedExists && sourceLinksExists
    ? "parcel_source_links l JOIN parcels_unified u ON u.id = l.unified_parcel_id"
    : "(SELECT NULL::text AS state_code LIMIT 0) u";
  const safeConflictFrom = duplicateGroupsExists
    ? "parcel_duplicate_groups g"
    : "(SELECT NULL::text AS group_key LIMIT 0) g";

  const result = (await pool.query(
    `WITH source_counts AS (
       SELECT source_id, COUNT(*)::bigint::text AS count
         FROM ${safeRawFrom}
        WHERE state_code = $1
         GROUP BY source_id
     ),
     source_json AS (
       SELECT COALESCE(jsonb_object_agg(source_id, count::int), '{}'::jsonb) AS payload
         FROM source_counts
     ),
      coverage AS (
        SELECT
          (SELECT COUNT(*)::bigint::text FROM ${safeRawFrom} WHERE state_code = $1) AS raw_features_count,
          (SELECT COUNT(*)::bigint::text FROM ${safeUnifiedFrom} WHERE state_code = $1) AS unified_parcels_count,
          (SELECT COUNT(*)::bigint::text FROM ${safeUnifiedFrom} WHERE state_code = $1 AND is_true_parcel = TRUE) AS true_parcels_count,
          (SELECT COUNT(*)::bigint::text FROM ${safeUnifiedFrom} WHERE state_code = $1 AND is_true_parcel = FALSE) AS plss_count,
          (SELECT COALESCE(SUM(area_acres), 0)::text FROM ${safeUnifiedFrom} WHERE state_code = $1) AS covered_area_acres,
          (SELECT COUNT(*)::bigint::text
             FROM ${safeSourceLinksJoin}
            WHERE u.state_code = $1) AS duplicate_links_count,
          (SELECT COUNT(*)::bigint::text
             FROM ${safeConflictFrom}
            WHERE g.group_key LIKE $2) AS conflicts_count
      )
     SELECT coverage.*, source_json.payload AS source_payload
       FROM coverage, source_json`,
    [stateCode, `${stateCode}:%`]
  )) as {
    rows: Array<{
      raw_features_count: string;
      unified_parcels_count: string;
      true_parcels_count: string;
      plss_count: string;
      covered_area_acres: string;
      duplicate_links_count: string;
      conflicts_count: string;
      source_payload: Record<string, number>;
    }>;
  };

  const row = result.rows[0];
  const trueCount = Number(row?.true_parcels_count ?? 0);
  const plssCount = Number(row?.plss_count ?? 0);
  let engineMode: ParcelCoverageSummary["engine_mode"] = "none";
  if (trueCount > 0 && plssCount > 0) engineMode = "mixed";
  else if (trueCount > 0) engineMode = "true_parcels";
  else if (plssCount > 0) engineMode = "parcel_like_fallback";

  return {
    state_code: stateCode,
    raw_features_count: Number(row?.raw_features_count ?? 0),
    unified_parcels_count: Number(row?.unified_parcels_count ?? 0),
    true_parcels_count: trueCount,
    plss_count: plssCount,
    sources: row?.source_payload ?? {},
    approximate_covered_area_acres: Number(row?.covered_area_acres ?? 0),
    duplicate_links_count: Number(row?.duplicate_links_count ?? 0),
    conflicts_count: Number(row?.conflicts_count ?? 0),
    scanner_relation: relation,
    engine_mode: engineMode,
  };
}
