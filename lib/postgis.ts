import type { Pool as PgPool, PoolConfig } from "pg";
import type { QueryablePool } from "./postgres";
import { getPostgisQueryTimeoutMs, getSelectedSpatialDatabaseUrl } from "./db/spatial-config";

let pool: QueryablePool | null = null;
let loadAttempted = false;
let loadError: string | null = null;

export async function getPostGISPool(): Promise<QueryablePool | null> {
  const { url: databaseUrl } = getSelectedSpatialDatabaseUrl();
  if (!databaseUrl) return null;
  if (pool) return pool;
  if (loadAttempted) return null;
  loadAttempted = true;

  try {
    const pg = await import("pg");
    const PoolCtor: new (config: PoolConfig) => PgPool =
      pg.Pool ?? (pg as any).default?.Pool;

    if (typeof PoolCtor !== "function") {
      throw new Error("pg module loaded but Pool constructor not found");
    }

    const useSsl =
      !databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1");
    const statementTimeout = getPostgisQueryTimeoutMs();
    pool = new PoolCtor({
      connectionString: databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: statementTimeout,
      statement_timeout: statementTimeout,
    });

    return pool;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    console.warn("[postgis] driver load failed:", loadError);
    return null;
  }
}

export function getPostGISLoadError(): string | null {
  return loadError;
}
