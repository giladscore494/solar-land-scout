import type { CandidateSite } from "./domain";

export type ScanEvent =
  | {
      type: "scan_started";
      stateCode: string;
      totalCells: number;
      bbox: [number, number, number, number];
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
      rejected_by: Record<string, number>;
      passed: number;
      processed: number;
      total: number;
    }
  | {
      type: "scan_completed";
      runId: number | null;
      passed: number;
      total: number;
      rejected_by: Record<string, number>;
      at: string;
    }
  | {
      type: "scan_error";
      message: string;
      /** The analysis stage where the error occurred, e.g. "scanning_cells" */
      stage?: string;
      /** True when the scan was explicitly cancelled by the client */
      cancelled?: boolean;
      at: string;
    }
  | {
      type: "scan_heartbeat";
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
      type: "hot_zone_identified";
      count: number;
      stateCode: string;
      at: string;
    }
  | {
      type: "parcel_evaluated";
      parcelId: string;
      apn: string | null;
      stateCode: string;
      at: string;
    }
  | {
      type: "parcel_passed";
      parcelId: string;
      apn: string | null;
      score: number;
      geojson: string;
      stateCode: string;
      at: string;
    }
  | {
      type: "parcel_rejected";
      parcelId: string;
      reason: string;
      stateCode: string;
      at: string;
    };
