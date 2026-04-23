"use client";

import { useReducer, useRef, useCallback } from "react";
import type { CandidateSite } from "@/types/domain";
import type { ScanEvent } from "@/types/scan-events";

export interface ScanProgress {
  processed: number;
  total: number;
}

export interface ScanTally {
  rejected_by: Record<string, number>;
  passed: number;
}

export interface ScanState {
  status: "idle" | "scanning" | "done" | "error";
  progress: ScanProgress;
  tally: ScanTally;
  currentCellId: string | null;
  insights: string[];
  passedSites: CandidateSite[];
  errorMessage: string | null;
  runId: number | null;
  cellResults: Map<string, { verdict: "passed" | "soft_reject" | "hard_reject"; bbox: [number, number, number, number] }>;
}

type ScanAction =
  | { type: "START" }
  | { type: "SCAN_STARTED"; totalCells: number }
  | { type: "CELL_RESULT"; event: Extract<ScanEvent, { type: "cell_result" }> }
  | { type: "INSIGHT"; text: string; cellsCovered: number }
  | { type: "TALLY_UPDATE"; rejected_by: Record<string, number>; passed: number; processed: number; total: number }
  | { type: "COMPLETED"; runId: number | null; passed: number; total: number; rejected_by: Record<string, number> }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

const initialState: ScanState = {
  status: "idle",
  progress: { processed: 0, total: 0 },
  tally: { rejected_by: {}, passed: 0 },
  currentCellId: null,
  insights: [],
  passedSites: [],
  errorMessage: null,
  runId: null,
  cellResults: new Map(),
};

function reducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "START":
      return { ...initialState, status: "scanning", cellResults: new Map() };
    case "SCAN_STARTED":
      return {
        ...state,
        progress: { ...state.progress, total: action.totalCells },
      };
    case "CELL_RESULT": {
      const newMap = new Map(state.cellResults);
      newMap.set(action.event.cellId, { verdict: action.event.verdict, bbox: action.event.bbox });
      return {
        ...state,
        currentCellId: action.event.cellId,
        cellResults: newMap,
        passedSites:
          action.event.verdict === "passed" && action.event.site
            ? [...state.passedSites, action.event.site]
            : state.passedSites,
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
        progress: { processed: action.processed, total: action.total },
        tally: { rejected_by: action.rejected_by, passed: action.passed },
      };
    case "COMPLETED":
      return {
        ...state,
        status: "done",
        runId: action.runId,
        progress: { processed: action.total, total: action.total },
        tally: { rejected_by: action.rejected_by, passed: action.passed },
      };
    case "ERROR":
      return { ...state, status: "error", errorMessage: action.message };
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
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        let dataLine = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6).trim();
          } else if (line === "" && eventType && dataLine) {
            try {
              const event = JSON.parse(dataLine) as ScanEvent;
              handleEvent(event, dispatch);
            } catch {
              // ignore parse errors
            }
            eventType = "";
            dataLine = "";
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        dispatch({ type: "ERROR", message: err.message });
      }
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "RESET" });
  }, []);

  return { start, cancel, state };
}

function handleEvent(event: ScanEvent, dispatch: React.Dispatch<ScanAction>): void {
  switch (event.type) {
    case "scan_started":
      dispatch({ type: "SCAN_STARTED", totalCells: event.totalCells });
      break;
    case "cell_result":
      dispatch({ type: "CELL_RESULT", event });
      break;
    case "insight":
      dispatch({ type: "INSIGHT", text: event.text, cellsCovered: event.cellsCovered });
      break;
    case "tally_update":
      dispatch({
        type: "TALLY_UPDATE",
        rejected_by: event.rejected_by,
        passed: event.passed,
        processed: event.processed,
        total: event.total,
      });
      break;
    case "scan_completed":
      dispatch({
        type: "COMPLETED",
        runId: event.runId,
        passed: event.passed,
        total: event.total,
        rejected_by: event.rejected_by,
      });
      break;
    case "scan_error":
      dispatch({ type: "ERROR", message: event.message });
      break;
  }
}
