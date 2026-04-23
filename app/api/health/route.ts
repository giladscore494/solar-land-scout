import { NextResponse } from "next/server";
import { getPostgresPool, getPostgresLoadError } from "@/lib/postgres";
import { getPostGISPool, getPostGISLoadError } from "@/lib/postgis";
import { ensureSchema } from "@/lib/db-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mask(v: string | undefined | null): string | null {
  if (!v) return null;
  if (v.length <= 8) return v.slice(0, 2) + "…" + v.slice(-2);
  return v.slice(0, 4) + "…" + v.slice(-4);
}

function envEntry(v: string | undefined | null): { configured: boolean; masked: string | null } {
  const trimmed = typeof v === "string" ? v.trim() : "";
  return { configured: !!trimmed, masked: trimmed ? mask(trimmed) : null };
}

interface ProbeResult {
  reachable: boolean;
  latency_ms: number;
  error?: string;
}

async function probe(url: string, init?: RequestInit): Promise<ProbeResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    const latency_ms = Date.now() - start;
    return { reachable: res.ok || res.status < 500, latency_ms };
  } catch (err) {
    return {
      reachable: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : "error",
    };
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  const env = {
    gemini: envEntry(process.env.GEMINI_API_KEY),
    nrel: envEntry(process.env.NREL_API_KEY),
    maptiler: envEntry(process.env.NEXT_PUBLIC_MAPTILER_KEY),
    mapbox: envEntry(process.env.NEXT_PUBLIC_MAPBOX_TOKEN),
    googleSolar: envEntry(process.env.GOOGLE_SOLAR_API_KEY),
    database: { configured: !!process.env.DATABASE_URL?.trim() },
    spatial_database: { configured: !!process.env.SUPABASE_DATABASE_URL?.trim() },
    anthropic: envEntry(process.env.ANTHROPIC_API_KEY),
    supabase_publishable: envEntry(process.env.SUPABASE_PUBLISHABLE_KEY),
  };

  // DB diagnostics
  const database: {
    connected: boolean;
    driver_installed: boolean;
    driver_load_error: string | null;
    latency_ms: number;
    schema_ready: boolean;
    states_rows: number;
    sites_rows: number;
    error: string | null;
  } = {
    connected: false,
    driver_installed: false,
    driver_load_error: null,
    latency_ms: 0,
    schema_ready: false,
    states_rows: 0,
    sites_rows: 0,
    error: null,
  };

  const pool = env.database.configured ? await getPostgresPool() : null;
  if (pool) {
    database.driver_installed = true;
    try {
      const start = Date.now();
      await pool.query("SELECT 1");
      database.connected = true;
      database.latency_ms = Date.now() - start;
      try {
        await ensureSchema(pool);
        const states = (await pool.query(
          "SELECT COUNT(*)::text AS c FROM states_macro"
        )) as { rows: { c: string }[] };
        const sites = (await pool.query(
          "SELECT COUNT(*)::text AS c FROM candidate_sites"
        )) as { rows: { c: string }[] };
        database.schema_ready = true;
        database.states_rows = Number(states.rows[0]?.c ?? 0);
        database.sites_rows = Number(sites.rows[0]?.c ?? 0);
      } catch (err) {
        database.error = err instanceof Error ? err.message : "schema error";
      }
    } catch (err) {
      database.error = err instanceof Error ? err.message : "connection error";
    }
  } else if (env.database.configured) {
    const driverErr = getPostgresLoadError();
    database.driver_load_error = driverErr;
    database.error = driverErr ? "pg driver not installed" : "pg driver unavailable";
  }

  // Spatial database (Supabase/PostGIS) diagnostics
  const spatial_database: {
    connected: boolean;
    driver_installed: boolean;
    driver_load_error: string | null;
    latency_ms: number;
    postgis_version: string | null;
    parcels_count: number;
    transmission_count: number;
    error: string | null;
  } = {
    connected: false,
    driver_installed: false,
    driver_load_error: null,
    latency_ms: 0,
    postgis_version: null,
    parcels_count: 0,
    transmission_count: 0,
    error: null,
  };

  if (env.spatial_database.configured) {
    const spatialPool = await getPostGISPool();
    if (spatialPool) {
      spatial_database.driver_installed = true;
      try {
        const start = Date.now();
        await spatialPool.query("SELECT 1");
        spatial_database.connected = true;
        spatial_database.latency_ms = Date.now() - start;
        try {
          const ver = (await spatialPool.query(
            "SELECT PostGIS_Version() AS v"
          )) as { rows: { v: string }[] };
          spatial_database.postgis_version = ver.rows[0]?.v ?? null;
          const parcels = (await spatialPool.query(
            "SELECT COUNT(*)::text AS c FROM parcels"
          )) as { rows: { c: string }[] };
          spatial_database.parcels_count = Number(parcels.rows[0]?.c ?? 0);
          const trans = (await spatialPool.query(
            "SELECT COUNT(*)::text AS c FROM transmission_lines"
          )) as { rows: { c: string }[] };
          spatial_database.transmission_count = Number(trans.rows[0]?.c ?? 0);
        } catch (err) {
          spatial_database.error = err instanceof Error ? err.message : "schema not ready";
        }
      } catch (err) {
        spatial_database.error = err instanceof Error ? err.message : "connection error";
      }
    } else {
      const driverErr = getPostGISLoadError();
      spatial_database.driver_load_error = driverErr;
      spatial_database.error = driverErr ? "pg driver not installed" : "pg driver unavailable";
    }
  }

  // Enricher reachability — run in parallel under a 3s cap.
  const overall = new AbortController();
  const cap = setTimeout(() => overall.abort(), 3000);

  const probes: Record<string, Promise<ProbeResult>> = {
    usgs_elevation: probe(
      "https://epqs.nationalmap.gov/v1/json?x=-111.65&y=33.4&units=Meters&wkid=4326&includeDate=False"
    ),
    osm_overpass: probe("https://overpass-api.de/api/status"),
    usgs_padus: probe(
      "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Protected_Areas_Database_of_the_United_States_PAD_US_4_0/FeatureServer/0?f=json"
    ),
    fema_flood: probe(
      "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28?f=json"
    ),
    nasa_power: probe(
      "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=-111.65&latitude=33.4&format=JSON"
    ),
  };
  if (env.googleSolar.configured) {
    probes.google_solar = probe(
      `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=37.42&location.longitude=-122.08&requiredQuality=LOW&key=${encodeURIComponent(
        (process.env.GOOGLE_SOLAR_API_KEY as string).trim()
      )}`
    );
  }

  const names = Object.keys(probes);
  const settled = await Promise.allSettled(names.map((n) => probes[n]));
  clearTimeout(cap);

  const enrichers: Record<string, ProbeResult> = {};
  names.forEach((n, i) => {
    const s = settled[i];
    enrichers[n] =
      s.status === "fulfilled"
        ? s.value
        : { reachable: false, latency_ms: 0, error: "probe failed" };
  });

  return NextResponse.json(
    {
      ok: !env.database.configured || database.driver_installed,
      generated_at: new Date().toISOString(),
      env,
      database,
      spatial_database,
      enrichers,
      build: {
        commit_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
        node_env: process.env.NODE_ENV ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
