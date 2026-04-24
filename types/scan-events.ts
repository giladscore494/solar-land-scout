import type { Geometry } from "geojson";
import type { CandidateSite } from "./domain";

export type ScanEngine = "grid" | "parcel";

export type ScanEvent =
  | {
      type: "scan_started";
      engine: ScanEngine;
      stateCode: string;
      totalCells?: number;
      totalParcels?: number;
      processed: number;
      passed: number;
      rejected: number;
      currentStage: string;
      bbox?: [number, number, number, number];
      at: string;
    }
  | {
      type: "cell_started";
      cellId: string;
      bbox: [number, number, number, number];
      row: number;
      col: number;
    }
  | {
      type: "cell_result";
      cellId: string;
      bbox: [number, number, number, number];
      verdict: "passed" | "soft_reject" | "hard_reject";
      rejectionReason: string;
      site?: CandidateSite;
    }
  | {
      type: "insight";
      text: string;
      cellsCovered: number;
      at: string;
    }
  | {
      type: "tally_update";
      engine?: ScanEngine;
      rejected_by: Record<string, number>;
      passed: number;
      rejected?: number;
      processed: number;
      total: number;
    }
  | {
      type: "scan_completed";
      engine?: ScanEngine;
      runId: number | null;
      passed: number;
      total: number;
      rejected_by: Record<string, number>;
      at: string;
    }
  | {
      type: "scan_error";
      engine?: ScanEngine;
      message: string;
      /** The analysis stage where the error occurred, e.g. "scanning_cells" */
      stage?: string;
      /** True when the scan was explicitly cancelled by the client */
      cancelled?: boolean;
      at: string;
    }
  | {
      type: "scan_heartbeat";
      engine?: ScanEngine;
      /** Current processing stage label */
      stage: string;
      /** Human-readable description of what is happening right now */
      activity: string;
      processed: number;
      total: number;
      elapsed_ms: number;
      at: string;
    }
  | {
      type: "parcel_result";
      engine: "parcel";
      parcelId: string;
      status: "passed" | "rejected" | "error";
      score?: number;
      reason?: string;
      geometry?: Geometry;
      centroid?: { lat: number; lng: number };
      properties?: Record<string, unknown>;
      site?: CandidateSite;
      processed: number;
      passed: number;
      rejected: number;
      total: number;
      totalParcels: number;
      currentStage: string;
      at: string;
    };
