import { getPostGISLoadError, getPostGISPool } from "@/lib/postgis";
import { getPostgisQueryTimeoutMs, getSelectedSpatialDatabaseUrl } from "./spatial-config";
import type { DbHealthCounts, DbHealthResult, ScanDbHealthSummary } from "@/types/db-health";
import { detectScannerParcelRelation, getParcelCoverageSummary } from "@/lib/importers/parcel-db";

const REQUIRED_TABLES = [
  "parcels",
  "transmission_lines",
  "substations",
  "protected_areas",
  "flood_zones",
] as const;

type RequiredTable = (typeof REQUIRED_TABLES)[number];

const REQUIRED_RUNTIME_COLUMNS: Record<RequiredTable, string[]> = {
  parcels: ["id", "state_code", "geom"],
  transmission_lines: ["id", "geom"],
  substations: ["id", "geom"],
  protected_areas: ["id", "geom"],
  flood_zones: ["id", "geom"],
};

const OPTIONAL_METADATA_COLUMNS: Record<RequiredTable, string[]> = {
  parcels: [
    "zoning",
    "county",
    "updated_at",
    "area_acres",
    "owner_name",
    "source",
    "source_id",
    "county_fips",
    "acres",
    "centroid",
    "bbox",
  ],
  transmission_lines: ["source", "updated_at", "voltage_kv", "owner", "status"],
  substations: ["source", "updated_at", "name", "max_voltage_kv", "owner", "status"],
  protected_areas: [
    "category",
    "updated_at",
    "name",
    "source",
    "source_id",
    "designation",
    "managing_agency",
  ],
  flood_zones: ["zone", "source", "updated_at", "flood_zone", "sfha", "source_id"],
};

const INDEX_TARGETS: Array<{ table: RequiredTable; name: string }> = [
  { table: "parcels", name: "parcels.geom" },
  { table: "transmission_lines", name: "transmission_lines.geom" },
  { table: "substations", name: "substations.geom" },
  { table: "protected_areas", name: "protected_areas.geom" },
  { table: "flood_zones", name: "flood_zones.geom" },
];

const EMPTY_COUNTS: DbHealthCounts = {
  parcels_total: 0,
  parcels_for_state: null,
  unified_parcels_total: 0,
  unified_parcels_for_state: null,
  transmission_lines_total: 0,
  substations_total: 0,
  protected_areas_total: 0,
  flood_zones_total: 0,
};

interface HealthOptions {
  stateCode?: string | null;
}

function makeBaseResult(stateCode?: string | null): DbHealthResult {
  return {
    ok: false,
    database_connected: false,
    postgis_available: false,
    selected_url_env: null,
    required_tables: {
      parcels: false,
      transmission_lines: false,
      substations: false,
      protected_areas: false,
      flood_zones: false,
    },
    missing_tables: [...REQUIRED_TABLES],
    missing_columns: {},
    blocking_missing_columns: {},
    optional_missing_columns: {},
    missing_indexes: [],
    counts: {
      ...EMPTY_COUNTS,
      parcels_for_state: stateCode ? 0 : null,
      unified_parcels_for_state: stateCode ? 0 : null,
    },
    warnings: [],
    reason: null,
    elapsed_ms: 0,
    step_elapsed_ms: {},
    url_kind: null,
    parcel_coverage: null,
    legacy_parcels_for_state: stateCode ? 0 : null,
    unified_parcels_for_state: stateCode ? 0 : null,
    scanner_parcels_for_state: stateCode ? 0 : null,
    effective_parcels_for_state: stateCode ? 0 : null,
    scanner_relation: null,
    parcel_engine_usable: false,
  };
}

function normalizeStateCode(stateCode?: string | null): string | null {
  const normalized = stateCode?.trim().toUpperCase() ?? "";
  return normalized ? normalized : null;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.toLowerCase().includes("timeout") ||
    ("code" in error && (error as Error & { code?: string }).code === "57014")
  );
}

function pushWarning(result: DbHealthResult, warning: string): void {
  if (!result.warnings.includes(warning)) {
    result.warnings.push(warning);
  }
}

function setReason(result: DbHealthResult, reason: string): void {
  if (!result.reason) {
    result.reason = reason;
  }
}

function tableSql(table: RequiredTable): string {
  switch (table) {
    case "parcels":
      return "parcels";
    case "transmission_lines":
      return "transmission_lines";
    case "substations":
      return "substations";
    case "protected_areas":
      return "protected_areas";
    case "flood_zones":
      return "flood_zones";
  }
}

async function measure<T>(
  result: DbHealthResult,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    result.step_elapsed_ms![key] = Date.now() - started;
  }
}

function getOptionalColumnsForTable(table: RequiredTable, columns: Set<string>): string[] {
  return OPTIONAL_METADATA_COLUMNS[table].filter((column) => {
    if (column === "area_acres" && !columns.has("geom")) {
      return false;
    }
    return !columns.has(column);
  });
}

function hasBlockingMissingColumns(result: DbHealthResult): boolean {
  return Object.keys(result.blocking_missing_columns).length > 0;
}

interface ParcelEngineAvailabilityInput {
  stateCode?: string | null;
  legacyParcelsForState: number | null;
  unifiedParcelsForState: number | null;
  scannerParcelsForState: number | null;
  legacyParcelsTotal: number;
  unifiedParcelsTotal: number;
  scannerRelation: "scanner_parcels" | "parcels" | null;
  baseUsable: boolean;
  reason: string | null;
}

interface ParcelEngineAvailability {
  effectiveParcelsForState: number | null;
  effectiveParcelsTotal: number;
  parcelEngineUsable: boolean;
  reason: string | null;
}

export function resolveParcelEngineAvailability(
  input: ParcelEngineAvailabilityInput
): ParcelEngineAvailability {
  const scannerBackedStateCount =
    (input.scannerParcelsForState ?? 0) > 0
      ? Math.max(input.scannerParcelsForState ?? 0, input.unifiedParcelsForState ?? 0)
      : null;
  const effectiveParcelsForState =
    input.stateCode
      ? scannerBackedStateCount ?? input.legacyParcelsForState ?? 0
      : null;
  const effectiveParcelsTotal =
    input.scannerRelation === "scanner_parcels" && input.unifiedParcelsTotal > 0
      ? input.unifiedParcelsTotal
      : input.legacyParcelsTotal;
  const availabilityCount = input.stateCode
    ? effectiveParcelsForState ?? 0
    : effectiveParcelsTotal;

  let reason = input.reason;
  if (reason === "PARCEL_STATE_EMPTY" && availabilityCount > 0) {
    reason = null;
  }
  if (!reason && input.stateCode && availabilityCount === 0) {
    reason = "PARCEL_STATE_EMPTY";
  }

  return {
    effectiveParcelsForState,
    effectiveParcelsTotal,
    parcelEngineUsable: input.baseUsable && availabilityCount > 0,
    reason,
  };
}

export function summarizeDbHealth(result: DbHealthResult): ScanDbHealthSummary {
  return {
    selected_url_env: result.selected_url_env,
    database_connected: result.database_connected,
    postgis_available: result.postgis_available,
    missing_tables: result.missing_tables,
    missing_columns: result.blocking_missing_columns,
    blocking_missing_columns: result.blocking_missing_columns,
    optional_missing_columns: result.optional_missing_columns,
    missing_indexes: result.missing_indexes,
    parcels_for_state: result.counts.parcels_for_state,
    unified_parcels_for_state: result.counts.unified_parcels_for_state,
    warnings: result.warnings,
    reason: result.reason,
    parcel_coverage: result.parcel_coverage ?? null,
    legacy_parcels_for_state: result.legacy_parcels_for_state ?? null,
    scanner_parcels_for_state: result.scanner_parcels_for_state ?? null,
    effective_parcels_for_state: result.effective_parcels_for_state ?? null,
    scanner_relation: result.scanner_relation ?? null,
    parcel_engine_usable: result.parcel_engine_usable ?? false,
  };
}

export function getParcelEngineFallbackReason(result: DbHealthResult): string | null {
  if (result.parcel_engine_usable === true || result.ok === true) return null;
  if (result.reason === "DB_ENV_MISSING") return "DB_ENV_MISSING";
  if (result.reason === "DB_CONNECTION_FAILED" || !result.database_connected) return "DB_CONNECTION_FAILED";
  if (result.reason === "POSTGIS_NOT_AVAILABLE" || !result.postgis_available) return "POSTGIS_NOT_AVAILABLE";
  if (result.missing_tables.length > 0) return "PARCEL_TABLES_MISSING";
  if (hasBlockingMissingColumns(result)) return "PARCEL_REQUIRED_COLUMNS_MISSING";
  if (result.missing_indexes.length > 0) return "PARCEL_REQUIRED_INDEXES_MISSING";
  if (
    result.reason === "PARCEL_STATE_EMPTY" ||
    (result.effective_parcels_for_state != null && result.effective_parcels_for_state === 0)
  ) {
    return "PARCEL_STATE_EMPTY";
  }
  return result.reason ?? "PARCEL_ENGINE_UNAVAILABLE";
}

export async function checkDatabaseHealth(options: HealthOptions = {}): Promise<DbHealthResult> {
  const started = Date.now();
  const stateCode = normalizeStateCode(options.stateCode);
  const result = makeBaseResult(stateCode);
  const selection = getSelectedSpatialDatabaseUrl();
  result.selected_url_env = selection.envName;
  result.url_kind = selection.urlKind;

  if (!selection.url) {
    result.reason = "DB_ENV_MISSING";
    result.elapsed_ms = Date.now() - started;
    return result;
  }

  const pool = await getPostGISPool();
  if (!pool) {
    result.reason = "DB_CONNECTION_FAILED";
    if (getPostGISLoadError()) {
      pushWarning(result, "PostGIS driver failed to load");
    }
    result.elapsed_ms = Date.now() - started;
    return result;
  }
  const db = pool;
  let unifiedTableExists = false;
  let scannerParcelsExists = false;
  let scannerParcelsForState: number | null = stateCode ? 0 : null;

  try {
    await measure(result, "connection", async () => {
      await db.query("SELECT 1");
      result.database_connected = true;
    });
  } catch (error) {
    result.reason = "DB_CONNECTION_FAILED";
    pushWarning(
      result,
      isTimeoutError(error)
        ? `Database connection timed out after ${getPostgisQueryTimeoutMs()}ms`
        : "Database connection failed"
    );
    result.elapsed_ms = Date.now() - started;
    return result;
  }

  try {
    await measure(result, "postgis", async () => {
      await db.query("SELECT postgis_version()");
      result.postgis_available = true;
    });
  } catch {
    result.reason = "POSTGIS_NOT_AVAILABLE";
    result.elapsed_ms = Date.now() - started;
    return result;
  }

  const existingTables = await measure(result, "tables", async () => {
    const query = (await db.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES]
    )) as { rows: Array<{ table_name: RequiredTable }> };
    return new Set(query.rows.map((row) => row.table_name));
  });

  result.missing_tables = REQUIRED_TABLES.filter((table) => !existingTables.has(table));
  result.required_tables = {
    parcels: existingTables.has("parcels"),
    transmission_lines: existingTables.has("transmission_lines"),
    substations: existingTables.has("substations"),
    protected_areas: existingTables.has("protected_areas"),
    flood_zones: existingTables.has("flood_zones"),
  };

  if (result.missing_tables.length > 0) {
    setReason(result, "PARCEL_TABLES_MISSING");
  }

  const existingColumns = await measure(result, "columns", async () => {
    const query = (await db.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES]
    )) as { rows: Array<{ table_name: RequiredTable; column_name: string }> };
    const byTable = new Map<RequiredTable, Set<string>>();
    for (const row of query.rows) {
      const set = byTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      byTable.set(row.table_name, set);
    }
    return byTable;
  });

  for (const table of REQUIRED_TABLES) {
    if (!existingTables.has(table)) continue;
    const columns = existingColumns.get(table) ?? new Set<string>();
    const blockingMissing = REQUIRED_RUNTIME_COLUMNS[table].filter((column) => !columns.has(column));
    const optionalMissing = getOptionalColumnsForTable(table, columns);

    if (blockingMissing.length > 0) {
      result.blocking_missing_columns[table] = blockingMissing;
    }
    if (optionalMissing.length > 0) {
      result.optional_missing_columns[table] = optionalMissing;
      pushWarning(result, `${table} optional columns missing: ${optionalMissing.join(", ")}`);
    }
    if (table === "parcels" && optionalMissing.includes("area_acres") && columns.has("geom")) {
      pushWarning(result, "parcels.area_acres missing; using geometry area fallback");
    }
  }

  result.missing_columns = result.blocking_missing_columns;

  if (hasBlockingMissingColumns(result)) {
    setReason(result, "PARCEL_REQUIRED_COLUMNS_MISSING");
  }

  result.missing_indexes = await measure(result, "indexes", async () => {
    const query = (await db.query(
      `SELECT tablename, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])`,
      [REQUIRED_TABLES]
    )) as { rows: Array<{ tablename: RequiredTable; indexdef: string }> };

    return INDEX_TARGETS.filter(({ table }) => {
      return !query.rows.some((row) => {
        const normalized = row.indexdef.toLowerCase().replace(/\s+/g, " ");
        return row.tablename === table && normalized.includes("using gist") && normalized.includes("(geom)");
      });
    }).map(({ name }) => name);
  });

  if (result.missing_indexes.length > 0) {
    pushWarning(result, `Missing GiST indexes: ${result.missing_indexes.join(", ")}`);
    setReason(result, "PARCEL_REQUIRED_INDEXES_MISSING");
  }

  const parcelRelations = await measure(result, "parcel_relations", async () => {
    const query = (await db.query(
      `SELECT
         EXISTS (
           SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'parcels_unified'
         ) AS unified_present,
         EXISTS (
           SELECT 1
             FROM information_schema.views
            WHERE table_schema = 'public'
              AND table_name = 'scanner_parcels'
         ) AS scanner_present`
    )) as { rows: Array<{ unified_present: boolean; scanner_present: boolean }> };
    return query.rows[0] ?? { unified_present: false, scanner_present: false };
  });
  unifiedTableExists = parcelRelations.unified_present;
  scannerParcelsExists = parcelRelations.scanner_present;

  result.counts = await measure(result, "counts", async () => {
    const counts: DbHealthCounts = {
      ...EMPTY_COUNTS,
      parcels_for_state: stateCode ? 0 : null,
      unified_parcels_for_state: stateCode ? 0 : null,
    };

    async function countTable(table: RequiredTable): Promise<number> {
      const query = (await db.query(`SELECT COUNT(*)::bigint::text AS count FROM ${tableSql(table)}`)) as {
        rows: Array<{ count: string }>;
      };
      return Number(query.rows[0]?.count ?? 0);
    }

    if (existingTables.has("parcels")) {
      counts.parcels_total = await countTable("parcels");
      if (stateCode) {
        const query = (await db.query(
          "SELECT COUNT(*)::bigint::text AS count FROM parcels WHERE state_code = $1",
          [stateCode]
        )) as { rows: Array<{ count: string }> };
        counts.parcels_for_state = Number(query.rows[0]?.count ?? 0);
      }
    }
    if (unifiedTableExists) {
      const unifiedTotal = (await db.query(
        "SELECT COUNT(*)::bigint::text AS count FROM parcels_unified"
      )) as { rows: Array<{ count: string }> };
      counts.unified_parcels_total = Number(unifiedTotal.rows[0]?.count ?? 0);
      if (stateCode) {
        const query = (await db.query(
          "SELECT COUNT(*)::bigint::text AS count FROM parcels_unified WHERE state_code = $1",
          [stateCode]
        )) as { rows: Array<{ count: string }> };
        counts.unified_parcels_for_state = Number(query.rows[0]?.count ?? 0);
      }
    }
    if (scannerParcelsExists && stateCode) {
      const query = (await db.query(
        "SELECT COUNT(*)::bigint::text AS count FROM scanner_parcels WHERE state_code = $1",
        [stateCode]
      )) as { rows: Array<{ count: string }> };
      scannerParcelsForState = Number(query.rows[0]?.count ?? 0);
    }
    if (existingTables.has("transmission_lines")) {
      counts.transmission_lines_total = await countTable("transmission_lines");
    }
    if (existingTables.has("substations")) {
      counts.substations_total = await countTable("substations");
    }
    if (existingTables.has("protected_areas")) {
      counts.protected_areas_total = await countTable("protected_areas");
    }
    if (existingTables.has("flood_zones")) {
      counts.flood_zones_total = await countTable("flood_zones");
    }

    return counts;
  });

  result.legacy_parcels_for_state = result.counts.parcels_for_state;
  result.unified_parcels_for_state = result.counts.unified_parcels_for_state ?? null;
  result.scanner_parcels_for_state = scannerParcelsForState;

  await measure(result, "geometry_sanity", async () => {
    const tablesToCheck = REQUIRED_TABLES.filter((table) => existingTables.has(table));
    for (const table of tablesToCheck) {
      const sanity = (await db.query(
        `SELECT
           COUNT(*)::bigint::text AS total,
           COUNT(*) FILTER (WHERE geom IS NULL)::bigint::text AS geom_nulls,
           COUNT(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) = 0)::bigint::text AS srid_zero
         FROM ${tableSql(table)}`
      )) as { rows: Array<{ total: string; geom_nulls: string; srid_zero: string }> };
      const row = sanity.rows[0];
      const total = Number(row?.total ?? 0);
      const geomNulls = Number(row?.geom_nulls ?? 0);
      const sridZero = Number(row?.srid_zero ?? 0);
      if (total > 0 && geomNulls / total >= 0.1) {
        pushWarning(result, `${table} has ${geomNulls}/${total} rows with NULL geom`);
      }
      if (sridZero > 0) {
        pushWarning(result, `${table} has ${sridZero} rows with SRID 0`);
      }
    }
  });

  const scannerRelation = result.database_connected ? await detectScannerParcelRelation(db, stateCode) : "parcels";
  result.scanner_relation = scannerRelation;

  if (
    existingTables.has("parcels") &&
    !result.reason &&
    (!stateCode || (result.scanner_parcels_for_state ?? result.counts.parcels_for_state ?? 0) > 0)
  ) {
    try {
      await measure(result, "query_sanity", async () => {
        const relation = scannerRelation === "scanner_parcels" ? "scanner_parcels" : "parcels";
        if (stateCode) {
          await db.query(
            `SELECT id FROM ${relation} WHERE state_code = $1 AND geom IS NOT NULL LIMIT 1`,
            [stateCode]
          );
        } else {
          await db.query(`SELECT id FROM ${relation} WHERE geom IS NOT NULL LIMIT 1`);
        }
      });
    } catch (error) {
      pushWarning(
        result,
        isTimeoutError(error)
          ? `Parcel sanity query timed out after ${getPostgisQueryTimeoutMs()}ms`
          : "Parcel sanity query failed"
      );
    }
  }

  if (stateCode) {
    try {
      result.parcel_coverage = await getParcelCoverageSummary(db, stateCode);
      result.scanner_relation = result.parcel_coverage.scanner_relation;
      result.unified_parcels_for_state = result.parcel_coverage.unified_parcels_count;
      result.counts.unified_parcels_for_state = result.parcel_coverage.unified_parcels_count;
    } catch {
      result.parcel_coverage = null;
    }
  }

  const baseUsable =
    result.database_connected &&
    result.postgis_available &&
    result.missing_tables.length === 0 &&
    !hasBlockingMissingColumns(result) &&
    result.missing_indexes.length === 0;
  const parcelEngine = resolveParcelEngineAvailability({
    stateCode,
    legacyParcelsForState: result.legacy_parcels_for_state ?? null,
    unifiedParcelsForState: result.unified_parcels_for_state ?? null,
    scannerParcelsForState: result.scanner_parcels_for_state ?? null,
    legacyParcelsTotal: result.counts.parcels_total,
    unifiedParcelsTotal: result.counts.unified_parcels_total ?? 0,
    scannerRelation: result.scanner_relation ?? scannerRelation,
    baseUsable,
    reason: result.reason,
  });

  result.effective_parcels_for_state = parcelEngine.effectiveParcelsForState;
  result.counts.parcels_for_state = parcelEngine.effectiveParcelsForState ?? (stateCode ? 0 : null);
  result.reason = parcelEngine.reason;
  result.parcel_engine_usable = parcelEngine.parcelEngineUsable;

  if (parcelEngine.effectiveParcelsTotal === 0 && existingTables.has("parcels")) {
    pushWarning(result, "parcels table is empty; parcel scans will fall back to grid mode");
  }
  if (stateCode && parcelEngine.effectiveParcelsForState === 0) {
    pushWarning(result, `No parcels found for state ${stateCode}`);
  }

  result.ok =
    result.parcel_engine_usable;
  result.elapsed_ms = Date.now() - started;
  return result;
}
