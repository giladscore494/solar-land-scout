import { NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { normalizeLanguage } from "@/lib/i18n";
import { runStateAnalysis } from "@/lib/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { stateCode?: string; language?: string };
  try {
    body = (await req.json()) as { stateCode?: string; language?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.stateCode) {
    return NextResponse.json({ error: "state_required" }, { status: 400 });
  }

  const result = await runStateAnalysis(getRepository(), body.stateCode.toUpperCase(), normalizeLanguage(body.language));
  if (result.error === "state_not_found") {
    return NextResponse.json(result, { status: 404 });
  }
  if (result.error === "db_unavailable") {
    return NextResponse.json(result, { status: 503 });
  }
  if (result.error) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
