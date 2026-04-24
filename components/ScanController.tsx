"use client";

import { useReducer, useRef, useCallback } from "react";
import type { Geometry } from "geojson";
import type { CandidateSite } from "@/types/domain";
import type { ScanEngine, ScanEvent } from "@/types/scan-events";

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
  runId: number | null;
  debugLog: string[];
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
  | { type: "COMPLETED"; engine?: ScanEngine; runId: number | null; passed: number; total: number; rejected_by: Record<string, number> }
  | { type: "HEARTBEAT"; engine?: ScanEngine; stage: string; activity: string; processed: number; total: number }
  | { type: "ERROR"; message: string; stage?: string; cancelled?: boolean }
  | { type: "CANCELLED" }
  | { type: "RESET" };

const initialState: ScanState = {
  status: "idle",
  engine: null,
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
  runId: null,
  debugLog: [],
  cellResults: new Map(),
  parcelResults: new Map(),
};

function reducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "START":
      return {
        ...initialState,
        status: "scanning",
        cellResults: new Map(),
        parcelResults: new Map(),
      };
    case "SCAN_STARTED":
      return {
        ...state,
        engine: action.event.engine,
        progress: {
          processed: action.event.processed,
          total: action.event.totalParcels ?? action.event.totalCells ?? state.progress.total,
        },
        tally: {
          ...state.tally,
          passed: action.event.passed,
        },
        currentStage: action.event.currentStage,
        activityLine: `Starting ${action.event.engine} scan for ${action.event.stateCode}`,
        debugLog: appendDebug(
          state.debugLog,
          `${action.event.engine}:${action.event.currentStage} total=${
            action.event.totalParcels ?? action.event.totalCells ?? 0
          }`
        ),
      };
    case "CELL_RESULT": {
      const newMap = new Map(state.cellResults);
      newMap.set(action.event.cellId, { verdict: action.event.verdict, bbox: action.event.bbox });
      return {
        ...state,
        engine: "grid",
        currentCellId: action.event.cellId,
        cellResults: newMap,
        passedSites:
          action.event.verdict === "passed" && action.event.site
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
      const passedSites =
        action.event.site && !state.passedSites.some((site) => site.id === action.event.site.id)
          ? [...state.passedSites, action.event.site]
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
        passedSites,
        progress: { processed: action.event.processed, total: action.event.totalParcels },
        tally: { rejected_by, passed: action.event.passed },
        currentStage: action.event.currentStage,
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
      const completedEngine = action.engine ?? state.engine;
      return {
        ...state,
        status: "done",
        engine: completedEngine,
        runId: action.runId,
        progress: { processed: action.total, total: action.total },
        tally: { rejected_by: action.rejected_by, passed: action.passed },
        currentStage: "done",
        activityLine: `Scan complete — ${action.passed} sites passed out of ${action.total} ${
          completedEngine === "parcel" ? "parcels" : "cells"
        }`,
        debugLog: appendDebug(state.debugLog, `completed passed=${action.passed} total=${action.total}`),
      };
    }
    case "HEARTBEAT":
      return {
        ...state,
        engine: action.engine ?? state.engine,
        currentStage: action.stage,
        activityLine: action.activity,
        progress:
          action.total > 0
            ? { processed: action.processed, total: action.total }
            : state.progress,
        debugLog:
          action.activity === state.activityLine
            ? state.debugLog
            : appendDebug(state.debugLog, `${action.stage}: ${action.activity}`),
      };
    case "ERROR":
      return {
        ...state,
        status: action.cancelled ? "cancelled" : "error",
        errorMessage: action.message,
        cancelled: action.cancelled ?? false,
        currentStage: action.stage ?? state.currentStage,
        debugLog: appendDebug(
          state.debugLog,
          `${action.cancelled ? "cancelled" : "error"}:${action.stage ?? state.currentStage ?? "scan"} ${
            action.message
          }`
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
        dispatch({ type: "ERROR", message: `HTTP ${res.status}` });
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
        dispatch({ type: "ERROR", message: err.message });
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
      dispatch({
        type: "COMPLETED",
        engine: event.engine,
        runId: event.runId,
        passed: event.passed,
        total: event.total,
        rejected_by: event.rejected_by,
      });
      break;
    case "scan_heartbeat":
      dispatch({
        type: "HEARTBEAT",
        engine: event.engine,
        stage: event.stage,
        activity: event.activity,
        processed: event.processed,
        total: event.total,
      });
      break;
    case "scan_error":
      dispatch({
        type: "ERROR",
        message: event.message,
        stage: event.stage,
        cancelled: event.cancelled,
      });
      break;
  }
}

function appendDebug(lines: string[], next: string): string[] {
  return [next, ...lines].slice(0, 8);
}
