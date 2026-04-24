import { loadEnvConfig } from "@next/env";
import { checkDatabaseHealth } from "../lib/db/health";

loadEnvConfig(process.cwd());

async function main() {
  const stateCode = process.argv[2]?.trim().toUpperCase() || process.env.DB_HEALTH_STATE_CODE?.trim().toUpperCase();
  const health = await checkDatabaseHealth({ stateCode });
  process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
  process.exit(health.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
