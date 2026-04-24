import { NextRequest, NextResponse } from "next/server";
import { importAllEnabledSources, importArizonaCoreSources, importBlmNationalPlss, importSource, importStatewideSources } from "@/lib/importers/us-parcel-importers";

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

  const body = (await req.json().catch(() => null)) as {
    source?: string;
    group?: "az" | "statewide" | "plss";
    all_enabled?: boolean;
  } | null;

  if (body?.source) {
    return NextResponse.json(await importSource(body.source));
  }
  if (body?.group === "az") {
    return NextResponse.json(await importArizonaCoreSources());
  }
  if (body?.group === "statewide") {
    return NextResponse.json(await importStatewideSources());
  }
  if (body?.group === "plss") {
    return NextResponse.json(await importBlmNationalPlss());
  }
  if (body?.all_enabled) {
    return NextResponse.json(await importAllEnabledSources());
  }

  return NextResponse.json({ error: "source_or_group_required" }, { status: 400 });
}
