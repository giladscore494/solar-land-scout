import { loadEnvConfig } from "@next/env";
import { getPostGISPool } from "../lib/postgis";
import { checkDatabaseHealth } from "../lib/db/health";
import {
  buildOptionalSchemaRepairPlan,
  executeOptionalSchemaRepair,
} from "../lib/db/optional-schema-repair";

loadEnvConfig(process.cwd());

async function main() {
  const execute = process.argv.includes("--execute");
  const stateArg = process.argv.find((arg) => arg.startsWith("--state="));
  const stateCode = stateArg?.split("=")[1]?.trim().toUpperCase() || undefined;
  const pool = await getPostGISPool();

  if (!pool) {
    process.stderr.write("SUPABASE_DATABASE_URL not configured or pg unavailable\n");
    process.exit(1);
  }

  const healthBefore = await checkDatabaseHealth({ stateCode });
  const result = execute
    ? await executeOptionalSchemaRepair(pool, healthBefore, () => checkDatabaseHealth({ stateCode }))
    : buildOptionalSchemaRepairPlan(healthBefore);

  process.stdout.write(`${JSON.stringify({
    ...result,
    blocking_missing_columns: healthBefore.blocking_missing_columns,
    fallback_reason: healthBefore.reason,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
