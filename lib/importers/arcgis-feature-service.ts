import type { QueryablePool } from "@/lib/postgres";
import type { ParcelSource } from "./parcel-source-registry";
import { insertRawParcelFeature, pickFirstString } from "./parcel-importer-utils";

interface ArcGisLayerMetadata {
  maxRecordCount?: number;
  supportsPagination?: boolean;
  advancedQueryCapabilities?: { supportsPagination?: boolean };
  fields?: Array<{ name: string; alias?: string }>;
  objectIdField?: string;
  uniqueIdField?: { name?: string };
  geometryType?: string;
}

interface ArcGisFeature {
  attributes?: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
  };
}

interface ArcGisQueryResponse {
  features?: ArcGisFeature[];
  objectIds?: number[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

interface ImportArcGisSourceResult {
  imported: number;
  skipped: number;
  failedPages: number;
  metadata: Record<string, unknown>;
}

interface ArcGisPageResult {
  imported: number;
  skipped: number;
  failed: boolean;
  failureDetail?: string;
}

export const PARCEL_IMPORT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 2;
const MAX_RETRIES = 3;

function buildLayerUrl(source: ParcelSource): string {
  return source.url.endsWith("/query") ? source.url.replace(/\/query$/i, "") : source.url;
}

function buildQueryUrl(source: ParcelSource): string {
  return source.url.endsWith("/query") ? source.url : `${buildLayerUrl(source)}/query`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, params: URLSearchParams, attempt = 0): Promise<T> {
  try {
    const response = await fetch(`${url}?${params.toString()}`, {
      signal: AbortSignal.timeout(PARCEL_IMPORT_REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (attempt >= MAX_RETRIES - 1) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    await sleep(500 * 2 ** attempt);
    return fetchJson<T>(url, params, attempt + 1);
  }
}

function ringSignedArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i] ?? [0, 0];
    const [x2, y2] = ring[i + 1] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function pointInRing(point: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    const intersect = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function esriRingsToMultiPolygon(rings: number[][][] | undefined): GeoJSON.MultiPolygon | null {
  if (!rings || rings.length === 0) return null;
  const outers: number[][][][] = [];
  const holes: number[][][] = [];

  for (const rawRing of rings) {
    if (!rawRing.length || !rawRing[0] || !rawRing[rawRing.length - 1]) {
      continue;
    }
    const ring =
      rawRing[0][0] === rawRing[rawRing.length - 1][0] && rawRing[0][1] === rawRing[rawRing.length - 1][1]
        ? rawRing
        : [...rawRing, rawRing[0]];
    if (ringSignedArea(ring) <= 0) {
      outers.push([ring]);
    } else {
      holes.push(ring);
    }
  }

  if (outers.length === 0 && holes.length > 0) {
    return { type: "MultiPolygon", coordinates: holes.map((ring) => [ring]) };
  }

  for (const hole of holes) {
    if (!hole[0]) continue;
    const owner = outers.find((polygon) => polygon[0]?.length && pointInRing(hole[0], polygon[0]));
    if (owner) owner.push(hole);
    else outers.push([hole]);
  }

  return outers.length > 0 ? { type: "MultiPolygon", coordinates: outers } : null;
}

async function fetchLayerMetadata(source: ParcelSource): Promise<ArcGisLayerMetadata> {
  return fetchJson<ArcGisLayerMetadata>(buildLayerUrl(source), new URLSearchParams({ f: "json" }));
}

async function fetchObjectIds(source: ParcelSource): Promise<number[]> {
  const payload = await fetchJson<ArcGisQueryResponse>(
    buildQueryUrl(source),
    new URLSearchParams({ where: "1=1", returnIdsOnly: "true", f: "json" })
  );
  return payload.objectIds ?? [];
}

async function fetchFeatureCount(source: ParcelSource): Promise<number | null> {
  try {
    const payload = await fetchJson<{ count?: number }>(
      buildQueryUrl(source),
      new URLSearchParams({ where: "1=1", returnCountOnly: "true", f: "json" })
    );
    return typeof payload.count === "number" ? payload.count : null;
  } catch {
    return null;
  }
}

async function fetchFeaturePage(
  source: ParcelSource,
  args: { resultOffset?: number; resultRecordCount?: number; objectIds?: string }
): Promise<ArcGisFeature[]> {
  const params = new URLSearchParams({
    where: args.objectIds ? "1=1" : "1=1",
    outFields: "*",
    returnGeometry: "true",
    geometryPrecision: "8",
    outSR: "4326",
    f: "json",
  });
  if (typeof args.resultOffset === "number") params.set("resultOffset", String(args.resultOffset));
  if (typeof args.resultRecordCount === "number") params.set("resultRecordCount", String(args.resultRecordCount));
  if (args.objectIds) params.set("objectIds", args.objectIds);
  const payload = await fetchJson<ArcGisQueryResponse>(buildQueryUrl(source), params);
  if (payload.error?.message) throw new Error(payload.error.message);
  return payload.features ?? [];
}

async function processFeatures(
  pool: QueryablePool,
  source: ParcelSource,
  importJobId: number,
  features: ArcGisFeature[]
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const feature of features) {
    try {
      const properties = feature.attributes ?? {};
      const geometry = esriRingsToMultiPolygon(feature.geometry?.rings);
      if (!geometry) {
        skipped++;
        continue;
      }
      const externalId =
        pickFirstString(properties, source.fields?.id ?? []) ??
        pickFirstString(properties, ["OBJECTID", "FID", "GlobalID"]);
      const apn = pickFirstString(properties, source.fields?.apn ?? []);
      const ownerName = pickFirstString(properties, source.fields?.owner ?? []);
      const county = pickFirstString(properties, source.fields?.county ?? []) ?? source.county ?? null;
      await insertRawParcelFeature(pool, {
        source,
        importJobId,
        geometry,
        properties,
        externalId,
        apn,
        ownerName,
        county,
        stateCode: source.state_code ?? null,
      });
      imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (index < tasks.length) {
      const current = index++;
      const task = tasks[current];
      if (!task) {
        continue;
      }
      results[current] = await task();
    }
  });
  await Promise.all(workers);
  return results;
}

export async function importArcGisParcelSource(
  pool: QueryablePool,
  source: ParcelSource,
  importJobId: number
): Promise<ImportArcGisSourceResult> {
  const metadata = await fetchLayerMetadata(source);
  const maxRecordCount = source.max_records_per_batch ?? metadata.maxRecordCount ?? 1000;
  const supportsPagination = metadata.supportsPagination ?? metadata.advancedQueryCapabilities?.supportsPagination ?? false;
  let imported = 0;
  let skipped = 0;
  let failedPages = 0;
  const failedDetails: string[] = [];

  if (supportsPagination) {
    const count = await fetchFeatureCount(source);
    const tasks: Array<() => Promise<ArcGisPageResult>> = [];
    if (count !== null) {
      for (let offset = 0; offset < count; offset += maxRecordCount) {
        tasks.push(async () => {
          try {
            const features = await fetchFeaturePage(source, {
              resultOffset: offset,
              resultRecordCount: maxRecordCount,
            });
            const outcome = await processFeatures(pool, source, importJobId, features);
            return { imported: outcome.imported, skipped: outcome.skipped, failed: false };
          } catch (error) {
            return {
              imported: 0,
              skipped: 0,
              failed: true,
              failureDetail: `offset ${offset}: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        });
      }
      const results = await runWithConcurrency(tasks, MAX_CONCURRENCY);
      for (const result of results) {
        imported += result?.imported ?? 0;
        skipped += result?.skipped ?? 0;
        if (result?.failed) {
          failedPages++;
          if (result.failureDetail) failedDetails.push(result.failureDetail);
        }
      }
    } else {
      for (let offset = 0; ; offset += maxRecordCount) {
        try {
          const features = await fetchFeaturePage(source, {
            resultOffset: offset,
            resultRecordCount: maxRecordCount,
          });
          if (features.length === 0) break;
          const outcome = await processFeatures(pool, source, importJobId, features);
          imported += outcome.imported;
          skipped += outcome.skipped;
          if (features.length < maxRecordCount) break;
        } catch (error) {
          failedPages++;
          failedDetails.push(`offset ${offset}: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
    }
  } else {
    const objectIds = await fetchObjectIds(source);
    const chunks: number[][] = [];
    for (let i = 0; i < objectIds.length; i += maxRecordCount) {
      chunks.push(objectIds.slice(i, i + maxRecordCount));
    }
    const tasks = chunks.map((chunk) => async (): Promise<ArcGisPageResult> => {
      try {
        const features = await fetchFeaturePage(source, { objectIds: chunk.join(",") });
        const outcome = await processFeatures(pool, source, importJobId, features);
        return { imported: outcome.imported, skipped: outcome.skipped, failed: false };
      } catch (error) {
        return {
          imported: 0,
          skipped: 0,
          failed: true,
          failureDetail: `objectIds ${chunk[0]}-${chunk[chunk.length - 1]}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });
    const results = await runWithConcurrency(tasks, MAX_CONCURRENCY);
    for (const result of results) {
      imported += result?.imported ?? 0;
      skipped += result?.skipped ?? 0;
      if (result?.failed) {
        failedPages++;
        if (result.failureDetail) failedDetails.push(result.failureDetail);
      }
    }
  }

  return {
    imported,
    skipped,
    failedPages,
    metadata: {
      maxRecordCount,
      supportsPagination,
      failed_pages: failedPages,
      failures: failedDetails.slice(0, 20),
    },
  };
}
