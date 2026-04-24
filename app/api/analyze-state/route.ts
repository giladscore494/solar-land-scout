import { NextRequest, NextResponse } from "next/server";
import { runStateScan } from "@/lib/agent/run-scan";
import { runParcelScan } from "@/lib/agent/parcel-scanner";
import { selectAnalyzeStateEngine } from "@/lib/agent/scan-engine";
import {
  checkDatabaseHealth,
  getParcelEngineFallbackReason,
  summarizeDbHealth,
} from "@/lib/db/health";
import type { ScanEvent } from "@/types/scan-events";
import type { ScanEngine } from "@/types/scan-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    state_code?: string;
    language?: "en" | "he";
    engine?: "grid" | "parcel";
    research_mode?: boolean;
  } | null;
  const stateCode = body?.state_code?.toUpperCase();
  if (!stateCode) {
    return NextResponse.json({ error: "state_code_required" }, { status: 400 });
  }

  // Validate state code has a bounding box
  try {
    const { getStateBbox } = await import("@/lib/agent/state-bbox");
    getStateBbox(stateCode);
  } catch {
    return NextResponse.json({ error: "state_not_found" }, { status: 404 });
  }

  const acceptsSSE = req.headers.get("accept")?.includes("text/event-stream") ?? false;

  const requestedEngine: ScanEngine = body?.engine ?? "parcel";
  let engine: ScanEngine = requestedEngine;
  let fallbackReason: string | null = null;
  let dbHealth = undefined;

  if (requestedEngine !== "grid") {
    const health = await checkDatabaseHealth({ stateCode });
    dbHealth = summarizeDbHealth(health);
    fallbackReason = getParcelEngineFallbackReason(health);
    engine = selectAnalyzeStateEngine(requestedEngine, health);
  }

  const runScan = engine === "parcel" ? runParcelScan : runStateScan;

  if (!acceptsSSE) {
    // Backward-compatible terminal JSON response
    try {
        const result = await runScan(stateCode, {
          signal: req.signal,
          researchMode: body?.research_mode,
        });
      return NextResponse.json({
        run_id: result.runId,
        status: "completed",
        generated: result.total,
        passing: result.passed,
        sites: result.sites,
        all_candidates: result.sites,
        borderline_candidates: result.scan_summary?.top_20_borderline_candidates ?? [],
        scan_summary: result.scan_summary,
        rejected_by: result.rejected_by,
        engine,
        requested_engine: requestedEngine,
        fallback_reason: fallbackReason,
        db_health: dbHealth,
        run_debug: {
          state_code: stateCode,
          requested_engine: requestedEngine,
          fallback_reason: fallbackReason,
          db_health: dbHealth,
          total_generated: result.total,
          total_passing_strict: result.passed,
          rejected_by: result.rejected_by,
          scan_summary: result.scan_summary,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: "analysis_failed", detail: error instanceof Error ? error.message : "unknown" },
        { status: 500 }
      );
    }
  }

  // SSE streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      function emit(event: ScanEvent): void {
        const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller may be closed
        }
      }

      runScan(stateCode, {
        signal: req.signal,
        onEvent: emit,
        requestedEngine,
        fallbackReason,
        dbHealth,
        researchMode: body?.research_mode,
      })
        .catch((err: unknown) => {
          const cancelled = req.signal.aborted;
          emit({
            type: "scan_error",
            engine,
            message: cancelled
              ? "scan_cancelled"
              : err instanceof Error
              ? err.message
              : "scan_failed",
            cancelled,
            at: new Date().toISOString(),
          });
        })
        .finally(() => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
