import { NextRequest, NextResponse } from "next/server";
import { getPostGISPool } from "@/lib/postgis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected || !token) return false;
  return token === expected;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pool = await getPostGISPool();
  if (!pool) {
    return NextResponse.json(
      { error: "supabase_not_configured", imports: [] },
      { status: 503 }
    );
  }

  try {
    const result = (await pool.query(
      `SELECT id, dataset, source_url, row_count, status, error_message, started_at, completed_at
       FROM gis_imports
       ORDER BY started_at DESC
       LIMIT 50`
    )) as { rows: unknown[] };

    return NextResponse.json({ imports: result.rows });
  } catch (err) {
    return NextResponse.json(
      { error: "query_failed", detail: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
