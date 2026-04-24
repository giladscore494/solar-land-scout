import type { QueryablePool } from "@/lib/postgres";
import { getPostGISPool } from "@/lib/postgis";
import { importArcGisParcelSource } from "./arcgis-feature-service";
import { importFileParcelSource } from "./file-geo-importer";
import { finishParcelImportJob, startParcelImportJob, syncParcelSource } from "./parcel-db";
import { getParcelSource, listEnabledParcelSources, PARCEL_SOURCES } from "./parcel-source-registry";

export interface ParcelSourceImportResult {
  source_id: string;
  status: "completed" | "failed" | "needs_url_discovery" | "skipped";
  imported_count: number;
  skipped_count: number;
  failed_count: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

async function resolvePool(pool?: QueryablePool | null): Promise<QueryablePool> {
  const resolved = pool ?? (await getPostGISPool());
  if (!resolved) {
    throw new Error("PostGIS database is required for parcel imports");
  }
  return resolved;
}

export async function importSource(
  sourceId: string,
  options: { pool?: QueryablePool | null; localPath?: string } = {}
): Promise<ParcelSourceImportResult> {
  const pool = await resolvePool(options.pool);
  const source = getParcelSource(sourceId);
  if (!source) {
    return { source_id: sourceId, status: "failed", imported_count: 0, skipped_count: 0, failed_count: 1, error: "unknown_source" };
  }

  await syncParcelSource(pool, source);

  if (source.status === "needs_url_discovery" || !source.url) {
    const job = await startParcelImportJob(pool, source.id, { status: "needs_url_discovery" });
    await finishParcelImportJob(pool, job.id, {
      status: "needs_url_discovery",
      importedCount: 0,
      skippedCount: 1,
      failedCount: 0,
      metadata: { reason: "needs_url_discovery", url: source.url },
    });
    return {
      source_id: source.id,
      status: "needs_url_discovery",
      imported_count: 0,
      skipped_count: 1,
      failed_count: 0,
      metadata: { url: source.url, reason: "needs_url_discovery" },
    };
  }

  const job = await startParcelImportJob(pool, source.id, { url: source.url, access_method: source.access_method });

  try {
    const outcome =
      source.access_method === "arcgis_feature_service" || source.access_method === "arcgis_map_service"
        ? await importArcGisParcelSource(pool, source, job.id)
        : await importFileParcelSource(pool, source, job.id, options.localPath);

    await finishParcelImportJob(pool, job.id, {
      status: outcome.failedPages && outcome.imported === 0 ? "partial_failure" : "completed",
      importedCount: outcome.imported,
      skippedCount: outcome.skipped,
      failedCount: outcome.failedPages ?? 0,
      metadata: outcome.metadata,
    });

    return {
      source_id: source.id,
      status: outcome.failedPages && outcome.imported === 0 ? "failed" : "completed",
      imported_count: outcome.imported,
      skipped_count: outcome.skipped,
      failed_count: outcome.failedPages ?? 0,
      metadata: outcome.metadata,
      error: outcome.failedPages ? `failed_pages=${outcome.failedPages}` : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishParcelImportJob(pool, job.id, {
      status: "failed",
      importedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      error: message,
      metadata: { url: source.url },
    });
    return {
      source_id: source.id,
      status: "failed",
      imported_count: 0,
      skipped_count: 0,
      failed_count: 1,
      error: message,
    };
  }
}

async function importGroup(
  sourceIds: string[],
  options: { pool?: QueryablePool | null; localPaths?: Record<string, string> } = {}
): Promise<ParcelSourceImportResult[]> {
  const results: ParcelSourceImportResult[] = [];
  for (const sourceId of sourceIds) {
    results.push(await importSource(sourceId, { pool: options.pool, localPath: options.localPaths?.[sourceId] }));
  }
  return results;
}

export async function importArizonaCoreSources(options: { pool?: QueryablePool | null } = {}) {
  return importGroup(
    [
      "az_state_trust_parcels",
      "az_maricopa_parcels",
      "az_pima_parcels",
      "az_pinal_parcels",
      "az_phoenix_parcels",
    ],
    options
  );
}

export async function importStatewideSources(options: { pool?: QueryablePool | null } = {}) {
  return importGroup(
    [
      "fl_statewide_parcels",
      "wi_statewide_parcels",
      "nc_statewide_parcels",
      "ma_property_tax_parcels",
      "ne_statewide_parcels",
      "or_taxlots",
      "wa_current_parcels",
    ],
    options
  );
}

export async function importBlmNationalPlss(options: { pool?: QueryablePool | null } = {}) {
  return importGroup(["blm_natl_plss"], options);
}

export async function importAllEnabledSources(options: { pool?: QueryablePool | null } = {}) {
  return importGroup(listEnabledParcelSources().map((source) => source.id), options);
}

export function listParcelSources() {
  return [...PARCEL_SOURCES];
}
