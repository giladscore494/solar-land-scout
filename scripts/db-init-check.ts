import { loadEnvConfig } from "@next/env";
import { checkDatabaseHealth } from "../lib/db/health";

loadEnvConfig(process.cwd());

async function main() {
  const stateCode = process.argv[2]?.trim().toUpperCase() || process.env.DB_HEALTH_STATE_CODE?.trim().toUpperCase();
  const health = await checkDatabaseHealth({ stateCode });

  process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);

  if (health.ok) {
    process.stdout.write("Spatial database is ready for parcel scans.\n");
    process.exit(0);
  }

  process.stdout.write(
    "Run: psql \"$SUPABASE_DATABASE_URL\" -f db/migrations/001_create_parcel_scan_tables.sql\n"
  );
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
