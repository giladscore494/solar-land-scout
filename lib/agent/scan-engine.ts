import type { ScanEngine } from "@/types/scan-events";

export function selectAnalyzeStateEngine(
  requestedEngine: ScanEngine,
  health?: { ok?: boolean; parcel_engine_usable?: boolean } | null
): ScanEngine {
  if (requestedEngine === "grid") {
    return "grid";
  }
  if (!health) {
    return requestedEngine;
  }
  if (typeof health.parcel_engine_usable === "boolean") {
    return health.parcel_engine_usable ? requestedEngine : "grid";
  }
  return health.ok ? requestedEngine : "grid";
}
