import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import type { StatesResponse } from "@/types/domain";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  const repo = getRepository();
  const states = await repo.listStates();
  const body: StatesResponse = {
    states,
    generated_at: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
