import type { Pool as PgPool, PoolConfig } from "pg";

export type QueryablePool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

let pool: QueryablePool | null = null;
let loadAttempted = false;
let loadError: string | null = null;

export async function getPostgresPool(): Promise<QueryablePool | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  if (pool) return pool;
  if (loadAttempted) return null;
  loadAttempted = true;

  try {
    // Dynamic import so a missing 'pg' at runtime doesn't crash the process
    const pg = await import("pg");
    const PoolCtor: new (config: PoolConfig) => PgPool =
      pg.Pool ?? (pg as any).default?.Pool;

    if (typeof PoolCtor !== "function") {
      throw new Error("pg module loaded but Pool constructor not found");
    }

    const useSsl =
      !databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1");
    pool = new PoolCtor({
      connectionString: databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    return pool;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    console.warn("[postgres] driver load failed; using JSON fallback:", loadError);
    return null;
  }
}

export function getPostgresLoadError(): string | null {
  return loadError;
}
