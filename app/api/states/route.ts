import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import type { StatesResponse } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const repo = getRepository();
  const [states, dbAvailable] = await Promise.all([repo.listStates(), repo.isDatabaseAvailable()]);
  const body: StatesResponse = {
    states,
    generated_at: new Date().toISOString(),
    db_available: dbAvailable,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
