import { NextRequest, NextResponse } from "next/server";
import { getPostGISPool } from "@/lib/postgis";
import { getParcelCoverageSummary } from "@/lib/importers/parcel-db";

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
  const stateCode = req.nextUrl.searchParams.get("state_code")?.trim().toUpperCase();
  if (!stateCode) {
    return NextResponse.json({ error: "state_code_required" }, { status: 400 });
  }
  const pool = await getPostGISPool();
  if (!pool) {
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
  return NextResponse.json(await getParcelCoverageSummary(pool, stateCode));
}
