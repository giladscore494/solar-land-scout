import type { QueryablePool } from "@/lib/postgres";

export async function recordImportStart(
  pool: QueryablePool,
  dataset: string,
  sourceUrl: string
): Promise<number> {
  const result = (await pool.query(
    `INSERT INTO gis_imports (dataset, source_url, status, started_at)
     VALUES ($1, $2, 'started', NOW())
     ON CONFLICT (dataset, started_at) DO UPDATE SET status='started'
     RETURNING id`,
    [dataset, sourceUrl]
  )) as { rows: { id: number }[] };
  return result.rows[0]?.id ?? 0;
}

export async function recordImportComplete(
  pool: QueryablePool,
  importId: number,
  rowCount: number
): Promise<void> {
  await pool.query(
    `UPDATE gis_imports SET status='completed', row_count=$2, completed_at=NOW() WHERE id=$1`,
    [importId, rowCount]
  );
}

export async function recordImportError(
  pool: QueryablePool,
  importId: number,
  errorMessage: string
): Promise<void> {
  await pool.query(
    `UPDATE gis_imports SET status='failed', error_message=$2, completed_at=NOW() WHERE id=$1`,
    [importId, errorMessage]
  );
}
