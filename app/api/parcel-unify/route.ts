import { NextRequest, NextResponse } from "next/server";
import { unifyParcelSources } from "@/lib/importers/parcel-dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkMaintenanceAuth(req: NextRequest): boolean {
  const token = req.headers.get("x-maintenance-token");
  const expected = process.env.ADMIN_MAINTENANCE_TOKEN;
  return Boolean(expected && token && token === expected);
}

export async function POST(req: NextRequest) {
  if (!checkMaintenanceAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { state_code?: string } | null;
  const stateCode = body?.state_code?.trim().toUpperCase();
  return NextResponse.json(await unifyParcelSources({ stateCode }));
}
