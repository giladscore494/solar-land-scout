import { getPostGISPool } from "@/lib/postgis";
import { getParcelCoverageSummary } from "@/lib/importers/parcel-db";
import { PARCEL_SOURCES } from "@/lib/importers/parcel-source-registry";

async function main() {
  const pool = await getPostGISPool();
  const stateCodeIndex = process.argv.indexOf("--state");
  const stateCode = stateCodeIndex >= 0 ? process.argv[stateCodeIndex + 1]?.toUpperCase() : "AZ";

  const coverage = pool ? await getParcelCoverageSummary(pool, stateCode) : null;
  const report = {
    state_code: stateCode,
    coverage,
    sources: PARCEL_SOURCES.map((source) => ({
      id: source.id,
      name: source.name,
      source_type: source.source_type,
      state_code: source.state_code,
      priority: source.priority,
      enabled_by_default: source.enabled_by_default,
      status: source.status ?? "ready",
      url: source.url,
      license_note: source.license_note,
    })),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
