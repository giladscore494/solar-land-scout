import { getPostGISPool } from "@/lib/postgis";
import { getParcelSource } from "@/lib/importers/parcel-source-registry";
import {
  importAllEnabledSources,
  importArizonaCoreSources,
  importBlmNationalPlss,
  importSource,
  importStatewideSources,
} from "@/lib/importers/us-parcel-importers";

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const pool = await getPostGISPool();
  if (!pool) throw new Error("PostGIS database is required");

  const source = getArg("--source");
  const group = getArg("--group");
  const allEnabled = process.argv.includes("--all-enabled");

  let result: unknown;
  if (source) {
    if (!getParcelSource(source)) {
      throw new Error(`Unknown source: ${source}`);
    }
    result = await importSource(source, { pool });
  } else if (group === "az") {
    result = await importArizonaCoreSources({ pool });
  } else if (group === "statewide") {
    result = await importStatewideSources({ pool });
  } else if (group === "plss") {
    result = await importBlmNationalPlss({ pool });
  } else if (allEnabled) {
    result = await importAllEnabledSources({ pool });
  } else {
    throw new Error(
      "Provide --source <id>, --group <az|statewide|plss>, or --all-enabled"
    );
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
