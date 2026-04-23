import type { QueryablePool } from "@/lib/postgres";
import { importBlmSmaAz } from "./blm-sma";
import { importHifldTransmission } from "./hifld-transmission";
import { importHifldSubstations } from "./hifld-substations";
import { importCountyParcels } from "./county-parcels";
import { importPadusAz } from "./padus-protected";
import { importFemaFloodAz } from "./fema-flood";

export type DatasetKey =
  | "blm_sma_az"
  | "hifld_transmission"
  | "hifld_substations"
  | "county_parcels_az"
  | "padus_az"
  | "fema_flood_az";

export interface ImportAllOptions {
  stateCode?: string;
  datasets?: DatasetKey[];
  dryRun?: boolean;
  onProgress?: (dataset: string, status: string, rows?: number, error?: string) => void;
}

export interface ImportAllResult {
  results: Record<string, { rows: number; error?: string }>;
  totalRows: number;
}

const ALL_DATASETS: DatasetKey[] = [
  "blm_sma_az",
  "hifld_transmission",
  "hifld_substations",
  "county_parcels_az",
  "padus_az",
  "fema_flood_az",
];

export async function importAll(
  pool: QueryablePool,
  opts: ImportAllOptions = {}
): Promise<ImportAllResult> {
  const { datasets = ALL_DATASETS, dryRun = false, onProgress } = opts;
  const results: Record<string, { rows: number; error?: string }> = {};
  let totalRows = 0;

  if (dryRun) {
    for (const ds of datasets) {
      results[ds] = { rows: 0 };
      onProgress?.(ds, "dry_run_skipped", 0);
    }
    return { results, totalRows: 0 };
  }

  for (const dataset of datasets) {
    onProgress?.(dataset, "started");
    try {
      let rows = 0;
      switch (dataset) {
        case "blm_sma_az":
          rows = await importBlmSmaAz(pool);
          break;
        case "hifld_transmission":
          rows = await importHifldTransmission(pool);
          break;
        case "hifld_substations":
          rows = await importHifldSubstations(pool);
          break;
        case "county_parcels_az": {
          const countyResults = await importCountyParcels(pool);
          rows = Object.values(countyResults).reduce((a, b) => a + b, 0);
          break;
        }
        case "padus_az":
          rows = await importPadusAz(pool);
          break;
        case "fema_flood_az":
          rows = await importFemaFloodAz(pool);
          break;
      }
      results[dataset] = { rows };
      totalRows += rows;
      onProgress?.(dataset, "completed", rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[dataset] = { rows: 0, error: msg };
      onProgress?.(dataset, "error", 0, msg);
    }
  }

  return { results, totalRows };
}
