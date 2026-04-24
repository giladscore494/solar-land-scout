import { NextRequest, NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/db/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns 503 only when the server cannot reach a usable PostGIS database at all
 * (missing URL, connection failure, or PostGIS unavailable). Schema/data issues
 * still return 200 with ok=false so developers can inspect exact missing pieces.
 */
export async function GET(req: NextRequest) {
  const stateCode = req.nextUrl.searchParams.get("state_code")?.trim().toUpperCase() ?? null;
  const health = await checkDatabaseHealth({ stateCode });
  const hardUnavailable =
    health.reason === "DATABASE_URL_MISSING" ||
    health.reason === "DATABASE_DRIVER_LOAD_FAILED" ||
    health.reason === "DATABASE_POOL_UNAVAILABLE" ||
    health.reason === "DATABASE_CONNECTION_TIMEOUT" ||
    health.reason === "DATABASE_CONNECTION_FAILED" ||
    health.reason === "POSTGIS_NOT_AVAILABLE";

  return NextResponse.json(health, {
    status: hardUnavailable ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
