import { createRequire } from "node:module";

type QueryablePool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

let pool: QueryablePool | null = null;
let loadAttempted = false;

export function getPostgresPool(): QueryablePool | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  if (pool) return pool;
  if (loadAttempted) return null;

  loadAttempted = true;

  try {
    const req = createRequire(import.meta.url);
    const { Pool } = req(["p", "g"].join("")) as {
      Pool: new (config: Record<string, unknown>) => QueryablePool;
    };

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("localhost")
        ? undefined
        : {
            rejectUnauthorized: false,
          },
    });

    return pool;
  } catch (error) {
    console.warn(
      "[repository] pg package unavailable; falling back to JSON repository",
      error
    );
    return null;
  }
}

export type { QueryablePool };
