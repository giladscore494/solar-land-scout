import type { DbHealthResult } from "@/types/db-health";
import type { QueryablePool } from "@/lib/postgres";

export const OPTIONAL_SCHEMA_REPAIR_STATEMENTS = [
  "ALTER TABLE parcels ADD COLUMN IF NOT EXISTS zoning TEXT;",
  "ALTER TABLE parcels ADD COLUMN IF NOT EXISTS county TEXT;",
  "ALTER TABLE parcels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;",
  "ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS source TEXT;",
  "ALTER TABLE transmission_lines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;",
  "ALTER TABLE substations ADD COLUMN IF NOT EXISTS source TEXT;",
  "ALTER TABLE substations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;",
  "ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS category TEXT;",
  "ALTER TABLE protected_areas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;",
  "ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS zone TEXT;",
  "ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS source TEXT;",
  "ALTER TABLE flood_zones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;",
] as const;

export interface OptionalSchemaRepairResult {
  dry_run: boolean;
  statements: readonly string[];
  optional_missing_columns_before: Record<string, string[]>;
  optional_missing_columns_after: Record<string, string[]>;
  executed_count: number;
}

export function buildOptionalSchemaRepairPlan(health: DbHealthResult): OptionalSchemaRepairResult {
  return {
    dry_run: true,
    statements: OPTIONAL_SCHEMA_REPAIR_STATEMENTS,
    optional_missing_columns_before: health.optional_missing_columns,
    optional_missing_columns_after: health.optional_missing_columns,
    executed_count: 0,
  };
}

export async function executeOptionalSchemaRepair(
  pool: QueryablePool,
  healthBefore: DbHealthResult,
  healthAfterFactory: () => Promise<DbHealthResult>
): Promise<OptionalSchemaRepairResult> {
  for (const statement of OPTIONAL_SCHEMA_REPAIR_STATEMENTS) {
    await pool.query(statement);
  }

  const healthAfter = await healthAfterFactory();
  return {
    dry_run: false,
    statements: OPTIONAL_SCHEMA_REPAIR_STATEMENTS,
    optional_missing_columns_before: healthBefore.optional_missing_columns,
    optional_missing_columns_after: healthAfter.optional_missing_columns,
    executed_count: OPTIONAL_SCHEMA_REPAIR_STATEMENTS.length,
  };
}
