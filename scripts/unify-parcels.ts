import { unifyParcelSources } from "@/lib/importers/parcel-dedupe";

async function main() {
  const stateCodeIndex = process.argv.indexOf("--state");
  const stateCode = stateCodeIndex >= 0 ? process.argv[stateCodeIndex + 1]?.toUpperCase() : undefined;
  const result = await unifyParcelSources({ stateCode });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
