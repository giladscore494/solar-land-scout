import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { FeatureCollection, Geometry } from "geojson";
import type { QueryablePool } from "@/lib/postgres";
import type { ParcelSource } from "./parcel-source-registry";
import { PARCEL_IMPORT_REQUEST_TIMEOUT_MS } from "./arcgis-feature-service";
import {
  geoJsonFeatureToProperties,
  insertRawParcelFeature,
  pickFirstString,
  toMultiPolygonGeometry,
} from "./parcel-importer-utils";

function hasGdal(): boolean {
  return Boolean(resolveOgr2OgrPath());
}

function resolveOgr2OgrPath(): string | null {
  const which = spawnSync("which", ["ogr2ogr"], { encoding: "utf8" });
  const resolved = which.stdout?.trim();
  return which.status === 0 && resolved.startsWith("/") ? resolved : null;
}

function ensureGdalOrThrow(format: ParcelSource["format"]): void {
  if (hasGdal()) return;
  throw new Error(
    `GDAL/ogr2ogr is required to import ${format ?? "this file"}. Install GDAL and ensure 'ogr2ogr' is available on PATH.`
  );
}

async function downloadToTemp(url: string, extension: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(PARCEL_IMPORT_REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed downloading ${url}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const dir = await mkdtemp(path.join(os.tmpdir(), "parcel-src-"));
  const filePath = path.join(dir, `source${extension}`);
  await import("node:fs/promises").then((fs) => fs.writeFile(filePath, buffer));
  return filePath;
}

async function convertWithGdal(inputPath: string, format: ParcelSource["format"]): Promise<string> {
  ensureGdalOrThrow(format);
  const ogr2ogrPath = resolveOgr2OgrPath();
  if (!ogr2ogrPath) {
    throw new Error("Unable to resolve ogr2ogr executable path");
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "parcel-gdal-"));
  const outputPath = path.join(dir, "output.geojson");
  const result = spawnSync(
    ogr2ogrPath,
    ["-t_srs", "EPSG:4326", "-f", "GeoJSON", outputPath, inputPath],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "ogr2ogr failed");
  }
  return outputPath;
}

export async function importFileParcelSource(
  pool: QueryablePool,
  source: ParcelSource,
  importJobId: number,
  localPath?: string
): Promise<{ imported: number; skipped: number; failedPages: number; metadata: Record<string, unknown> }> {
  const sourcePath =
    localPath ??
    (source.access_method === "download_file"
      ? await downloadToTemp(source.url, source.format === "geojson" ? ".geojson" : ".bin")
      : null);

  if (!sourcePath) {
    throw new Error("manual_file sources require a local path argument");
  }

  let geoJsonPath = sourcePath;
  if (source.format !== "geojson") {
    geoJsonPath = await convertWithGdal(sourcePath, source.format);
  }

  const raw = await readFile(geoJsonPath, "utf8");
  const featureCollection = JSON.parse(raw) as FeatureCollection;
  let imported = 0;
  let skipped = 0;

  for (const feature of featureCollection.features ?? []) {
    try {
      const geometry = toMultiPolygonGeometry(feature.geometry as Geometry | null);
      if (!geometry) {
        skipped++;
        continue;
      }
      const properties = geoJsonFeatureToProperties(feature);
      const externalId =
        pickFirstString(properties, source.fields?.id ?? []) ??
        (typeof feature.id === "string" || typeof feature.id === "number" ? String(feature.id) : null);
      const county = pickFirstString(properties, source.fields?.county ?? []) ?? source.county ?? null;
      await insertRawParcelFeature(pool, {
        source,
        importJobId,
        geometry,
        properties,
        externalId,
        apn: pickFirstString(properties, source.fields?.apn ?? []),
        ownerName: pickFirstString(properties, source.fields?.owner ?? []),
        county,
        stateCode: source.state_code ?? null,
      });
      imported++;
    } catch {
      skipped++;
    }
  }

  if (source.access_method === "download_file") {
    await rm(path.dirname(sourcePath), { recursive: true, force: true }).catch(() => undefined);
  }
  if (geoJsonPath !== sourcePath) {
    await rm(path.dirname(geoJsonPath), { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    imported,
    skipped,
    failedPages: 0,
    metadata: { format: source.format ?? "geojson", source_path: localPath ?? null },
  };
}
