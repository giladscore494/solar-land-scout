"use client";

import { useReducer, useRef, useCallback } from "react";
import type { Geometry } from "geojson";
import type { CandidateSite } from "@/types/domain";
import type { ScanEngine, ScanEvent, HotZoneProgressEvent } from "@/types/scan-events";
import type { ScanDbHealthSummary } from "@/types/db-health";

const MAX_DEBUG_LOG_SIZE = 10;

export interface ScanProgress {
  processed: number;
  total: number;
}

export interface ScanTally {
  rejected_by: Record<string, number>;
  passed: number;
}

export interface ScanState {
  status: "idle" | "scanning" | "done" | "error" | "cancelled";
  engine: ScanEngine | null;
  requestedEngine: ScanEngine | null;
  fallbackReason: string | null;
  dbHealth: ScanDbHealthSummary | null;
  hotzoneProgress: HotZoneProgressEvent | null;
  progress: ScanProgress;
  tally: ScanTally;
  currentCellId: string | null;
  currentParcelId: string | null;
  insights: string[];
  passedSites: CandidateSite[];
  errorMessage: string | null;
  /** True when the scan was explicitly cancelled by the user */
  cancelled: boolean;
  /** Current processing stage label from the server */
  currentStage: string | null;
  /** Human-readable activity description from the latest heartbeat */
  activityLine: string | null;
  elapsedMs: number;
  lastServerEventAt: string | null;
  runId: number | null;
  debugLog: string[];
  passedSiteIds: Set<string>;
  cellResults: Map<string, { verdict: "passed" | "soft_reject" | "hard_reject"; bbox: [number, number, number, number] }>;
  parcelResults: Map<
    string,
    {
      status: "passed" | "rejected" | "error";
      score?: number;
      reason?: string;
      geometry?: Geometry;
      centroid?: { lat: number; lng: number };
      properties?: Record<string, unknown>;
    }
  >;
}

type ScanAction =
  | { type: "START" }
  | { type: "SCAN_STARTED"; event: Extract<ScanEvent, { type: "scan_started" }> }
  | { type: "CELL_RESULT"; event: Extract<ScanEvent, { type: "cell_result" }> }
  | { type: "PARCEL_RESULT"; event: Extract<ScanEvent, { type: "parcel_result" }> }
  | { type: "INSIGHT"; text: string; cellsCovered: number }
  | { type: "TALLY_UPDATE"; engine?: ScanEngine; rejected_by: Record<string, number>; passed: number; processed: number; total: number }
  | { type: "COMPLETED"; event: Extract<ScanEvent, { type: "scan_completed" }> }
  | { type: "HEARTBEAT"; event: Extract<ScanEvent, { type: "scan_heartbeat" }> }
  | { type: "ERROR"; event: Extract<ScanEvent, { type: "scan_error" }> }
  | { type: "CANCELLED" }
  | { type: "RESET" };

const initialState: ScanState = {
  status: "idle",
  engine: null,
  requestedEngine: null,
  fallbackReason: null,
  dbHealth: null,
  hotzoneProgress: null,
  progress: { processed: 0, total: 0 },
  tally: { rejected_by: {}, passed: 0 },
  currentCellId: null,
  currentParcelId: null,
  insights: [],
  passedSites: [],
  errorMessage: null,
  cancelled: false,
  currentStage: null,
  activityLine: null,
  elapsedMs: 0,
  lastServerEventAt: null,
  runId: null,
  debugLog: [],
  passedSiteIds: new Set(),
  cellResults: new Map(),
  parcelResults: new Map(),
};

function reducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "START":
      return {
        ...initialState,
        status: "scanning",
        passedSiteIds: new Set(),
        cellResults: new Map(),
        parcelResults: new Map(),
      };
    case "SCAN_STARTED":
      return {
        ...state,
        engine: action.event.engine,
        requestedEngine: action.event.requestedEngine ?? action.event.engine,
        fallbackReason: action.event.fallbackReason ?? null,
        dbHealth: action.event.db_health ?? state.dbHealth,
        hotzoneProgress: action.event.hotzone_progress ?? state.hotzoneProgress,
        progress: {
          processed: action.event.processed,
          total: action.event.totalParcels ?? action.event.totalCells ?? state.progress.total,
        },
        tally: {
          ...state.tally,
          passed: action.event.passed,
        },
        currentStage: action.event.currentStage,
        activityLine:
          action.event.fallbackReason && action.event.engine === "grid"
            ? `Parcel engine unavailable: ${describeFallbackReason(action.event.fallbackReason)}. Falling back to grid scan.`
            : `Starting ${action.event.engine} scan for ${action.event.stateCode}`,
        elapsedMs: action.event.hotzone_progress?.elapsed_ms ?? state.elapsedMs,
        lastServerEventAt: action.event.at,
        debugLog: appendDebug(
          state.debugLog,
          formatScanEventLog(action.event)
        ),
      };
    case "CELL_RESULT": {
      const newMap = new Map(state.cellResults);
      newMap.set(action.event.cellId, { verdict: action.event.verdict, bbox: action.event.bbox });
      const nextPassedSiteIds = new Set(state.passedSiteIds);
      if (action.event.verdict === "passed" && action.event.site) {
        nextPassedSiteIds.add(action.event.site.id);
      }
      return {
        ...state,
        engine: "grid",
        currentCellId: action.event.cellId,
        cellResults: newMap,
        passedSiteIds: nextPassedSiteIds,
        passedSites:
          action.event.verdict === "passed" && action.event.site && !state.passedSiteIds.has(action.event.site.id)
            ? [...state.passedSites, action.event.site]
            : state.passedSites,
        debugLog: appendDebug(
          state.debugLog,
          `grid:${action.event.cellId}=${action.event.verdict}${
            action.event.rejectionReason ? ` (${action.event.rejectionReason})` : ""
          }`
        ),
      };
    }
    case "PARCEL_RESULT": {
      const parcelResults = new Map(state.parcelResults);
      parcelResults.set(action.event.parcelId, {
        status: action.event.status,
        score: action.event.score,
        reason: action.event.reason,
        geometry: action.event.geometry,
        centroid: action.event.centroid,
        properties: action.event.properties,
      });
      const nextSite = action.event.site;
      const nextPassedSiteIds = new Set(state.passedSiteIds);
      if (nextSite) {
        nextPassedSiteIds.add(nextSite.id);
      }
      const passedSites =
        nextSite && !state.passedSiteIds.has(nextSite.id)
          ? [...state.passedSites, nextSite]
          : state.passedSites;
      const rejected_by = { ...state.tally.rejected_by };
      if (action.event.status === "rejected" && action.event.reason) {
        rejected_by[action.event.reason] = (rejected_by[action.event.reason] ?? 0) + 1;
      } else if (action.event.status === "error") {
        rejected_by.parcel_error = (rejected_by.parcel_error ?? 0) + 1;
      }
      return {
        ...state,
        engine: "parcel",
        currentParcelId: action.event.parcelId,
        parcelResults,
        passedSiteIds: nextPassedSiteIds,
        passedSites,
        progress: { processed: action.event.processed, total: action.event.totalParcels },
        tally: { rejected_by, passed: action.event.passed },
        currentStage: action.event.currentStage,
        lastServerEventAt: action.event.at,
        activityLine:
          action.event.status === "passed"
            ? `Parcel ${action.event.parcelId} passed (${action.event.score ?? 0})`
            : action.event.status === "error"
            ? `Parcel ${action.event.parcelId} error: ${action.event.reason ?? "unknown"}`
            : `Parcel ${action.event.parcelId} rejected: ${action.event.reason ?? "unknown"}`,
        debugLog: appendDebug(
          state.debugLog,
          `parcel:${action.event.parcelId}=${action.event.status}${
            action.event.reason ? ` (${action.event.reason})` : ""
          }`
        ),
      };
    }
    case "INSIGHT":
      return {
        ...state,
        insights: [action.text, ...state.insights].slice(0, 5),
      };
    case "TALLY_UPDATE":
      return {
        ...state,
        engine: action.engine ?? state.engine,
        progress: { processed: action.processed, total: action.total },
        tally: { rejected_by: action.rejected_by, passed: action.passed },
      };
    case "COMPLETED": {
      const completedEngine = action.event.engine ?? state.engine;
      return {
        ...state,
        status: "done",
        engine: completedEngine,
        requestedEngine: action.event.requestedEngine ?? state.requestedEngine,
        fallbackReason: action.event.fallbackReason ?? state.fallbackReason,
        dbHealth: action.event.db_health ?? state.dbHealth,
        runId: action.event.runId,
        progress: { processed: action.event.total, total: action.event.total },
        tally: { rejected_by: action.event.rejected_by, passed: action.event.passed },
        currentStage: "done",
        activityLine: `Scan complete — ${action.event.passed} sites passed out of ${action.event.total} ${
          completedEngine === "parcel" ? "parcels" : "cells"
        }`,
        lastServerEventAt: action.event.at,
        debugLog: appendDebug(state.debugLog, formatScanEventLog(action.event)),
      };
    }
    case "HEARTBEAT":
      return {
        ...state,
        engine: action.event.engine ?? state.engine,
        requestedEngine: action.event.requestedEngine ?? state.requestedEngine,
        fallbackReason: action.event.fallbackReason ?? state.fallbackReason,
        dbHealth: action.event.db_health ?? state.dbHealth,
        hotzoneProgress: action.event.hotzone_progress ?? state.hotzoneProgress,
        currentStage: action.event.stage,
        activityLine: action.event.activity,
        progress:
          action.event.total > 0
            ? { processed: action.event.processed, total: action.event.total }
            : state.progress,
        elapsedMs: action.event.elapsed_ms,
        lastServerEventAt: action.event.at,
        debugLog:
          action.event.activity === state.activityLine
            ? state.debugLog
            : appendDebug(state.debugLog, formatScanEventLog(action.event)),
      };
    case "ERROR":
      return {
        ...state,
        status: action.event.cancelled ? "cancelled" : "error",
        requestedEngine: action.event.requestedEngine ?? state.requestedEngine,
        fallbackReason: action.event.fallbackReason ?? state.fallbackReason,
        dbHealth: action.event.db_health ?? state.dbHealth,
        errorMessage: action.event.message,
        cancelled: action.event.cancelled ?? false,
        currentStage: action.event.stage ?? state.currentStage,
        lastServerEventAt: action.event.at,
        debugLog: appendDebug(
          state.debugLog,
          formatScanEventLog(action.event)
        ),
      };
    case "CANCELLED":
      return {
        ...state,
        status: "cancelled",
        cancelled: true,
        activityLine: "Scan cancelled by user",
        debugLog: appendDebug(state.debugLog, "cancelled:user"),
      };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

export interface ScanControllerHandle {
  start: (stateCode: string) => void;
  cancel: () => void;
  state: ScanState;
}

export function useScanController(): ScanControllerHandle {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (stateCode: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: "START" });

    try {
      const res = await fetch("/api/analyze-state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ state_code: stateCode }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        dispatch({
          type: "ERROR",
          event: {
            type: "scan_error",
            message: `HTTP ${res.status}`,
            at: new Date().toISOString(),
          },
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            try {
              const trailing = buffer
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data: "))
                .map((line) => line.slice(6))
                .join("\n");
              if (trailing) {
                handleEvent(JSON.parse(trailing) as ScanEvent, dispatch);
              }
            } catch {
              // ignore parse errors
            }
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split(/\r?\n/);
          let data = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              data += `${line.slice(6)}\n`;
            }
          }
          if (!data) continue;
          try {
            const event = JSON.parse(data.trim()) as ScanEvent;
            handleEvent(event, dispatch);
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        dispatch({
          type: "ERROR",
          event: {
            type: "scan_error",
            message: err.message,
            at: new Date().toISOString(),
          },
        });
      } else if (err instanceof Error && err.name === "AbortError") {
        // User-initiated cancellation — RESET is handled by cancel()
      }
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "CANCELLED" });
  }, []);

  return { start, cancel, state };
}

function handleEvent(event: ScanEvent, dispatch: React.Dispatch<ScanAction>): void {
  switch (event.type) {
    case "scan_started":
      dispatch({ type: "SCAN_STARTED", event });
      break;
    case "cell_result":
      dispatch({ type: "CELL_RESULT", event });
      break;
    case "parcel_result":
      dispatch({ type: "PARCEL_RESULT", event });
      break;
    case "insight":
      dispatch({ type: "INSIGHT", text: event.text, cellsCovered: event.cellsCovered });
      break;
    case "tally_update":
      dispatch({
        type: "TALLY_UPDATE",
        engine: event.engine,
        rejected_by: event.rejected_by,
        passed: event.passed,
        processed: event.processed,
        total: event.total,
      });
      break;
    case "scan_completed":
      dispatch({ type: "COMPLETED", event });
      break;
    case "scan_heartbeat":
      dispatch({ type: "HEARTBEAT", event });
      break;
    case "scan_error":
      dispatch({ type: "ERROR", event });
      break;
  }
}

function appendDebug(lines: string[], next: string): string[] {
  return [next, ...lines].slice(0, MAX_DEBUG_LOG_SIZE);
}

function describeFallbackReason(reason: string): string {
  switch (reason) {
    case "DATABASE_URL_MISSING":
      return "database URL missing";
    case "DATABASE_DRIVER_UNAVAILABLE":
    case "DATABASE_CONNECTION_UNAVAILABLE":
    case "DATABASE_CONNECTION_FAILED":
    case "DATABASE_CONNECTION_TIMEOUT":
      return "database connection unavailable";
    case "POSTGIS_NOT_AVAILABLE":
      return "PostGIS extension unavailable";
    case "PARCEL_TABLES_MISSING":
      return "required parcel tables are missing";
    case "PARCEL_COLUMNS_MISSING":
      return "required parcel columns are missing";
    case "NO_PARCEL_DATA":
      return "parcel tables are empty";
    case "NO_PARCELS_FOR_STATE":
      return "no parcel data exists for this state";
    case "PARCEL_QUERY_TIMEOUT":
      return "parcel query timed out";
    default:
      return reason.toLowerCase().replaceAll("_", " ");
  }
}

function formatScanEventLog(event: ScanEvent): string {
  const timestamp = "at" in event ? event.at.slice(11, 19) : "--:--:--";
  switch (event.type) {
    case "scan_started":
      return `${timestamp} ${event.type} engine=${event.engine}${
        event.fallbackReason ? ` fallback=${event.fallbackReason}` : ""
      }`;
    case "scan_completed":
      return `${timestamp} ${event.type} passed=${event.passed}/${event.total}`;
    case "scan_error":
      return `${timestamp} ${event.type} ${event.message}`;
    case "scan_heartbeat":
      return `${timestamp} ${event.stage} ${event.processed}/${event.total}${
        event.hotzone_progress ? ` hotzones=${event.hotzone_progress.scanned}/${event.hotzone_progress.planned}` : ""
      }`;
    case "parcel_result":
      return `${timestamp} parcel:${event.parcelId}=${event.status}`;
    case "tally_update":
      return `${event.type} ${event.processed}/${event.total}`;
    case "cell_result":
      return `cell:${event.cellId}=${event.verdict}`;
    case "insight":
      return `${timestamp} insight ${event.cellsCovered}`;
    case "cell_started":
      return `cell_started:${event.cellId}`;
  }
}
