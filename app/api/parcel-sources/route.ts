import { NextRequest, NextResponse } from "next/server";
import { getPostGISPool } from "@/lib/postgis";
import { PARCEL_SOURCES } from "@/lib/importers/parcel-source-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkMaintenanceAuth(req: NextRequest): boolean {
  const token = req.headers.get("x-maintenance-token");
  const expected = process.env.ADMIN_MAINTENANCE_TOKEN;
  return Boolean(expected && token && token === expected);
}

export async function GET(req: NextRequest) {
  if (!checkMaintenanceAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pool = await getPostGISPool();
  if (!pool) {
    return NextResponse.json({ sources: PARCEL_SOURCES });
  }

  const jobs = (await pool.query(
    `SELECT DISTINCT ON (source_id)
        source_id, status, imported_count, skipped_count, failed_count, started_at, finished_at, error
       FROM parcel_import_jobs
      ORDER BY source_id, started_at DESC`
  )) as {
    rows: Array<{
      source_id: string;
      status: string;
      imported_count: number;
      skipped_count: number;
      failed_count: number;
      started_at: string;
      finished_at: string | null;
      error: string | null;
    }>;
  };
  const byId = new Map(jobs.rows.map((row) => [row.source_id, row]));

  return NextResponse.json({
    sources: PARCEL_SOURCES.map((source) => ({ ...source, latest_job: byId.get(source.id) ?? null })),
  });
}
