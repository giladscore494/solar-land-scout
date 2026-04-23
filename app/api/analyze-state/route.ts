import { NextRequest, NextResponse } from "next/server";
import { runStateScan } from "@/lib/agent/run-scan";
import { runParcelScan } from "@/lib/agent/parcel-scanner";
import { getPostGISPool } from "@/lib/postgis";
import type { ScanEvent } from "@/types/scan-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    state_code?: string;
    language?: "en" | "he";
    engine?: "grid" | "parcel";
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

  // Determine which engine to use
  const supabaseConfigured = !!process.env.SUPABASE_DATABASE_URL?.trim();
  let engine = body?.engine;
  if (!engine) {
    if (supabaseConfigured) {
      const pool = await getPostGISPool();
      engine = pool ? "parcel" : "grid";
    } else {
      engine = "grid";
    }
  }

  const runScan = engine === "parcel" ? runParcelScan : runStateScan;

  if (!acceptsSSE) {
    // Backward-compatible terminal JSON response
    try {
      const result = await runScan(stateCode, { signal: req.signal });
      return NextResponse.json({
        run_id: result.runId,
        status: "completed",
        generated: result.total,
        passing: result.passed,
        sites: result.sites,
        all_candidates: result.sites,
        rejected_by: result.rejected_by,
        engine,
        run_debug: {
          state_code: stateCode,
          total_generated: result.total,
          total_passing_strict: result.passed,
          rejected_by: result.rejected_by,
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
      })
        .catch((err: unknown) => {
          emit({
            type: "scan_error",
            message: err instanceof Error ? err.message : "scan_failed",
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
