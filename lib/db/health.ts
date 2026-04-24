import { getPostGISLoadError, getPostGISPool } from "@/lib/postgis";
import { getPostgisQueryTimeoutMs, getSelectedSpatialDatabaseUrl } from "./spatial-config";
import type { DbHealthCounts, DbHealthResult, ScanDbHealthSummary } from "@/types/db-health";

const REQUIRED_TABLES = [
  "parcels",
  "transmission_lines",
  "substations",
  "protected_areas",
  "flood_zones",
] as const;

type RequiredTable = (typeof REQUIRED_TABLES)[number];

const REQUIRED_COLUMNS: Record<RequiredTable, string[]> = {
  parcels: ["id", "state_code", "geom", "owner_name", "zoning", "county", "source", "updated_at"],
  transmission_lines: ["id", "geom", "source", "updated_at"],
  substations: ["id", "geom", "source", "updated_at"],
  protected_areas: ["id", "name", "category", "geom", "source", "updated_at"],
  flood_zones: ["id", "zone", "geom", "source", "updated_at"],
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
    missing_indexes: [],
    counts: {
      ...EMPTY_COUNTS,
      parcels_for_state: stateCode ? 0 : null,
    },
    warnings: [],
    reason: null,
    elapsed_ms: 0,
    step_elapsed_ms: {},
    url_kind: null,
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

export function summarizeDbHealth(result: DbHealthResult): ScanDbHealthSummary {
  return {
    selected_url_env: result.selected_url_env,
    database_connected: result.database_connected,
    postgis_available: result.postgis_available,
    missing_tables: result.missing_tables,
    missing_columns: result.missing_columns,
    missing_indexes: result.missing_indexes,
    parcels_for_state: result.counts.parcels_for_state,
    warnings: result.warnings,
    reason: result.reason,
  };
}

export function getParcelEngineFallbackReason(result: DbHealthResult): string | null {
  if (result.ok) return null;
  if (result.reason) return result.reason;
  if (result.missing_tables.length > 0) return "PARCEL_TABLES_MISSING";
  if (Object.keys(result.missing_columns).length > 0) return "PARCEL_COLUMNS_MISSING";
  return "PARCEL_ENGINE_UNAVAILABLE";
}

export async function checkDatabaseHealth(options: HealthOptions = {}): Promise<DbHealthResult> {
  const started = Date.now();
  const stateCode = normalizeStateCode(options.stateCode);
  const result = makeBaseResult(stateCode);
  const selection = getSelectedSpatialDatabaseUrl();
  result.selected_url_env = selection.envName;
  result.url_kind = selection.urlKind;

  if (!selection.url) {
    result.reason = "DATABASE_URL_MISSING";
    result.elapsed_ms = Date.now() - started;
    return result;
  }

  const pool = await getPostGISPool();
  if (!pool) {
    result.reason = getPostGISLoadError() ? "DATABASE_DRIVER_UNAVAILABLE" : "DATABASE_CONNECTION_UNAVAILABLE";
    result.elapsed_ms = Date.now() - started;
    return result;
  }
  const db = pool;

  try {
    await measure(result, "connection", async () => {
      await db.query("SELECT 1");
      result.database_connected = true;
    });
  } catch (error) {
    result.reason = isTimeoutError(error) ? "DATABASE_CONNECTION_TIMEOUT" : "DATABASE_CONNECTION_FAILED";
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
    result.reason = "PARCEL_TABLES_MISSING";
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
    const missing = REQUIRED_COLUMNS[table].filter((column) => !columns.has(column));
    if (table === "parcels" && !columns.has("area_acres") && columns.has("geom")) {
      pushWarning(result, "parcels.area_acres missing; using geometry area fallback");
    }
    if (table === "parcels" && !columns.has("area_acres")) {
      // geometry fallback is acceptable; do not count as missing when geom exists
      const idx = missing.indexOf("area_acres");
      if (idx >= 0) missing.splice(idx, 1);
    }
    if (missing.length > 0) {
      result.missing_columns[table] = missing;
    }
  }

  if (Object.keys(result.missing_columns).length > 0 && !result.reason) {
    result.reason = "PARCEL_COLUMNS_MISSING";
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
  }

  result.counts = await measure(result, "counts", async () => {
    const counts: DbHealthCounts = { ...EMPTY_COUNTS, parcels_for_state: stateCode ? 0 : null };

    async function countTable(table: string): Promise<number> {
      const query = (await db.query(`SELECT COUNT(*)::bigint::text AS count FROM ${table}`)) as {
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
    if (existingTables.has("transmission_lines")) counts.transmission_lines_total = await countTable("transmission_lines");
    if (existingTables.has("substations")) counts.substations_total = await countTable("substations");
    if (existingTables.has("protected_areas")) counts.protected_areas_total = await countTable("protected_areas");
    if (existingTables.has("flood_zones")) counts.flood_zones_total = await countTable("flood_zones");

    return counts;
  });

  await measure(result, "geometry_sanity", async () => {
    const tablesToCheck = REQUIRED_TABLES.filter((table) => existingTables.has(table));
    for (const table of tablesToCheck) {
      const sanity = (await db.query(
        `SELECT
           COUNT(*)::bigint::text AS total,
           COUNT(*) FILTER (WHERE geom IS NULL)::bigint::text AS geom_nulls,
           COUNT(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) = 0)::bigint::text AS srid_zero
         FROM ${table}`
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

  if (result.counts.parcels_total === 0 && existingTables.has("parcels") && !result.reason) {
    result.reason = "NO_PARCEL_DATA";
    pushWarning(result, "parcels table is empty; parcel scans will fall back to grid mode");
  }

  if (stateCode && result.counts.parcels_for_state === 0) {
    pushWarning(result, `No parcels found for state ${stateCode}`);
    if (!result.reason) {
      result.reason = "NO_PARCELS_FOR_STATE";
    }
  }

  if (existingTables.has("parcels") && (!result.reason || result.reason === "NO_PARCELS_FOR_STATE")) {
    try {
      await measure(result, "query_sanity", async () => {
        if (stateCode) {
          await db.query(
            "SELECT id FROM parcels WHERE state_code = $1 AND geom IS NOT NULL LIMIT 1",
            [stateCode]
          );
        } else {
          await db.query("SELECT id FROM parcels WHERE geom IS NOT NULL LIMIT 1");
        }
      });
    } catch (error) {
      result.reason = isTimeoutError(error) ? "PARCEL_QUERY_TIMEOUT" : "PARCEL_QUERY_FAILED";
      pushWarning(result, `Parcel sanity query failed after ${getPostgisQueryTimeoutMs()}ms timeout budget`);
    }
  }

  result.ok =
    result.database_connected &&
    result.postgis_available &&
    result.missing_tables.length === 0 &&
    Object.keys(result.missing_columns).length === 0 &&
    !result.reason;
  result.elapsed_ms = Date.now() - started;
  return result;
}
