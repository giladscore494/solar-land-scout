import type { Geometry } from "geojson";
import type { CandidateSite } from "./domain";
import type { ScanDbHealthSummary } from "./db-health";
import type { GridCellDiagnostics, GridScanSummary } from "./grid-scan";

export type ScanEngine = "grid" | "parcel";

export interface HotZoneProgressEvent {
  planned: number;
  scanned: number;
  current_bbox?: [number, number, number, number];
  current_lat?: number;
  current_lng?: number;
  current_ghi?: number | null;
  elapsed_ms: number;
}

export type ScanEvent =
  | {
      type: "scan_started";
      engine: ScanEngine;
      requestedEngine?: ScanEngine;
      fallbackReason?: string | null;
      db_health?: ScanDbHealthSummary;
      stateCode: string;
      totalCells?: number;
      totalParcels?: number;
      processed: number;
      passed: number;
      rejected: number;
      currentStage: string;
      hotzone_progress?: HotZoneProgressEvent;
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
      diagnostics?: GridCellDiagnostics;
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
      requestedEngine?: ScanEngine;
      fallbackReason?: string | null;
      db_health?: ScanDbHealthSummary;
      runId: number | null;
      passed: number;
      total: number;
      rejected_by: Record<string, number>;
      scan_summary?: GridScanSummary;
      at: string;
    }
  | {
      type: "scan_error";
      engine?: ScanEngine;
      requestedEngine?: ScanEngine;
      fallbackReason?: string | null;
      db_health?: ScanDbHealthSummary;
      message: string;
      stage?: string;
      cancelled?: boolean;
      at: string;
    }
  | {
      type: "scan_heartbeat";
      engine?: ScanEngine;
      stage: string;
      activity: string;
      requestedEngine?: ScanEngine;
      fallbackReason?: string | null;
      db_health?: ScanDbHealthSummary;
      hotzone_progress?: HotZoneProgressEvent;
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
