/**
 * One-time startup banner. Logs which keys are configured + DB connectivity.
 * Idempotent — guarded by a module-level flag so repeated calls are no-ops.
 */

import { getPostgresPool } from "./postgres";
import { getPostGISPool } from "./postgis";
import { ensureSchema } from "./db-schema";
import { ensureSpatialSchema } from "./postgis-schema";

let hasLogged = false;

function mark(present: boolean): string {
  return present ? "✔ configured" : "✖ missing";
}

function row(label: string, value: string): string {
  const labelCol = label.padEnd(26);
  return `║  ${labelCol} ${value}`;
}

export async function logStartupBanner(): Promise<void> {
  if (hasLogged) return;
  hasLogged = true;

  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════╗");
  lines.push("║  Solar Land Scout — runtime diagnostics          ║");
  lines.push("╠══════════════════════════════════════════════════╣");

  lines.push(row("GEMINI_API_KEY", mark(!!process.env.GEMINI_API_KEY?.trim())));
  lines.push(row("NREL_API_KEY", mark(!!process.env.NREL_API_KEY?.trim())));
  lines.push(row("NEXT_PUBLIC_MAPTILER_KEY", mark(!!process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim())));
  lines.push(row("NEXT_PUBLIC_MAPBOX_TOKEN", mark(!!process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim())));
  lines.push(row("GOOGLE_SOLAR_API_KEY", mark(!!process.env.GOOGLE_SOLAR_API_KEY?.trim())));
  lines.push(row("ANTHROPIC_API_KEY", mark(!!process.env.ANTHROPIC_API_KEY?.trim())));
  lines.push(row("SUPABASE_PUBLISHABLE_KEY", mark(!!process.env.SUPABASE_PUBLISHABLE_KEY?.trim())));
  lines.push(row("SUPABASE_SECRET_KEY", mark(!!process.env.SUPABASE_SECRET_KEY?.trim())));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    lines.push(row("DATABASE_URL", "✖ DATABASE_URL missing"));
  } else {
    const pool = await getPostgresPool();
    if (!pool) {
      lines.push(row("DATABASE_URL", "✖ pg driver not installed"));
    } else {
      try {
        const start = Date.now();
        await pool.query("SELECT 1");
        const latency = Date.now() - start;
        lines.push(row("DATABASE_URL", `✔ connected (${latency}ms)`));
        try {
          await ensureSchema(pool);
          const states = (await pool.query(
            "SELECT COUNT(*)::text AS c FROM states_macro"
          )) as { rows: { c: string }[] };
          const sites = (await pool.query(
            "SELECT COUNT(*)::text AS c FROM candidate_sites"
          )) as { rows: { c: string }[] };
          lines.push(
            row(
              "PG schema ready",
              `✔ ${states.rows[0]?.c ?? 0} states / ${sites.rows[0]?.c ?? 0} sites`
            )
          );
        } catch {
          lines.push(row("PG schema ready", "✖ tables not initialised (ensureSchema failed)"));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        lines.push(row("DATABASE_URL", `✖ unreachable (${msg})`));
      }
    }
  }

  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (!supabaseUrl) {
    lines.push(row("SUPABASE_DATABASE_URL", "✖ not configured (parcel engine disabled)"));
  } else {
    const spatialPool = await getPostGISPool();
    if (!spatialPool) {
      lines.push(row("SUPABASE_DATABASE_URL", "✖ pg driver not installed"));
    } else {
      try {
        const start = Date.now();
        await spatialPool.query("SELECT 1");
        const latency = Date.now() - start;
        lines.push(row("SUPABASE_DATABASE_URL", `✔ connected (${latency}ms)`));
        try {
          await ensureSpatialSchema(spatialPool);
          lines.push(row("Spatial schema ready", "✔ tables initialised"));
        } catch (schemaErr) {
          const schemaMsg = schemaErr instanceof Error ? schemaErr.message : "schema error";
          lines.push(row("Spatial schema ready", `✖ ${schemaMsg}`));
        }
        try {
          const ver = (await spatialPool.query(
            "SELECT PostGIS_version() AS v"
          )) as { rows: { v: string }[] };
          lines.push(row("PostGIS version", `✔ ${ver.rows[0]?.v ?? "unknown"}`));
        } catch {
          lines.push(row("PostGIS version", "✖ PostGIS extension not available"));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        lines.push(row("SUPABASE_DATABASE_URL", `✖ unreachable (${msg})`));
      }
    }
  }

  lines.push("╚══════════════════════════════════════════════════╝");

  // eslint-disable-next-line no-console
  console.log("\n" + lines.join("\n") + "\n");
}

/** Sync variant: fire-and-forget banner logging that never throws. */
export function kickBanner(): void {
  if (hasLogged) return;
  void logStartupBanner().catch(() => undefined);
}
