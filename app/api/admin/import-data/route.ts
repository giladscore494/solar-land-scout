import { NextRequest } from "next/server";
import { getPostGISPool } from "@/lib/postgis";
import { ensureSpatialSchema } from "@/lib/postgis-schema";
import { importAll } from "@/lib/importers/run-all";
import type { DatasetKey } from "@/lib/importers/run-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected || !token) return false;
  return token === expected;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => null)) as {
    datasets?: string[];
    state_code?: string;
    dry_run?: boolean;
  } | null;

  const pool = await getPostGISPool();
  if (!pool) {
    return new Response(
      JSON.stringify({ error: "supabase_not_configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  await ensureSpatialSchema(pool);

  const datasets = (body?.datasets ?? []) as DatasetKey[];
  const dryRun = body?.dry_run === true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: string, data: unknown): void {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[import-data] SSE stream error:", err);
        }
      }

      emit("import_started", { datasets, dry_run: dryRun, at: new Date().toISOString() });

      try {
        const result = await importAll(pool, {
          datasets: datasets.length > 0 ? datasets : undefined,
          dryRun,
          onProgress: (dataset, status, rows) => {
            if (status === "started") {
              emit("dataset_progress", { dataset, status: "started" });
            } else if (status === "completed") {
              emit("dataset_completed", { dataset, rows });
            } else if (status === "error") {
              emit("import_error", { dataset, error: status });
            }
          },
        });

        emit("import_completed", {
          results: result.results,
          total_rows: result.totalRows,
          at: new Date().toISOString(),
        });
      } catch (err) {
        emit("import_error", {
          error: err instanceof Error ? err.message : "import_failed",
          at: new Date().toISOString(),
        });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
