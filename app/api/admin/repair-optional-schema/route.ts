import { NextRequest, NextResponse } from "next/server";
import { getPostGISPool } from "@/lib/postgis";
import { checkDatabaseHealth } from "@/lib/db/health";
import {
  buildOptionalSchemaRepairPlan,
  executeOptionalSchemaRepair,
} from "@/lib/db/optional-schema-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasAdminToken(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token");
  const expected = process.env.ADMIN_IMPORT_TOKEN;
  return !!expected && !!token && token === expected;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    dry_run?: boolean;
    state_code?: string;
  } | null;
  const dryRun = body?.dry_run !== false;
  const stateCode = body?.state_code?.trim().toUpperCase() ?? undefined;

  if (!dryRun && !hasAdminToken(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pool = await getPostGISPool();
  if (!pool) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const healthBefore = await checkDatabaseHealth({ stateCode });
  if (dryRun) {
    return NextResponse.json(
      {
        ...buildOptionalSchemaRepairPlan(healthBefore),
        blocking_missing_columns: healthBefore.blocking_missing_columns,
        fallback_reason: healthBefore.reason,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const result = await executeOptionalSchemaRepair(pool, healthBefore, () =>
    checkDatabaseHealth({ stateCode })
  );

  return NextResponse.json(
    {
      ...result,
      blocking_missing_columns: healthBefore.blocking_missing_columns,
      fallback_reason_before: healthBefore.reason,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
