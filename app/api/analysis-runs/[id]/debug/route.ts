import { NextRequest, NextResponse } from "next/server";
import { getRunDebug } from "@/lib/analysis-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.ENABLE_DEBUG_JSON !== "true") {
    return NextResponse.json({ error: "debug_disabled" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const debug = await getRunDebug(Number(id));
  if (!debug) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ debug, rejected_by: debug.rejected_by ?? null });
}
