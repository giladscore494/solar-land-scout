import type { DatabaseUrlKind, SelectedDbUrlEnv } from "@/types/db-health";

export interface SpatialDatabaseSelection {
  envName: SelectedDbUrlEnv;
  url: string | null;
  urlKind: DatabaseUrlKind;
}

function readTrimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function detectDatabaseUrlKind(url: string | null): DatabaseUrlKind {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isPoolerHost = host === "pooler.supabase.com" || host.endsWith(".pooler.supabase.com");
    const isDirectHost =
      host === "supabase.co" ||
      host.endsWith(".supabase.co") ||
      host === "supabase.com" ||
      host.endsWith(".supabase.com");
    if (isPoolerHost || parsed.port === "6543") {
      return "pooler";
    }
    if (isDirectHost || parsed.port === "5432") {
      return "direct";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function getSelectedSpatialDatabaseUrl(): SpatialDatabaseSelection {
  const supabaseUrl = readTrimmed(process.env.SUPABASE_DATABASE_URL);
  if (supabaseUrl) {
    return {
      envName: "SUPABASE_DATABASE_URL",
      url: supabaseUrl,
      urlKind: detectDatabaseUrlKind(supabaseUrl),
    };
  }

  const databaseUrl = readTrimmed(process.env.DATABASE_URL);
  if (databaseUrl) {
    return {
      envName: "DATABASE_URL",
      url: databaseUrl,
      urlKind: detectDatabaseUrlKind(databaseUrl),
    };
  }

  return { envName: null, url: null, urlKind: null };
}

export function getMaxHotzoneCells(): number {
  return readPositiveInt(process.env.MAX_HOTZONE_CELLS, 150);
}

export function getNasaPowerTimeoutMs(): number {
  return readPositiveInt(process.env.NASA_POWER_TIMEOUT_MS, 8_000);
}

export function getPostgisQueryTimeoutMs(): number {
  return readPositiveInt(process.env.POSTGIS_QUERY_TIMEOUT_MS, 15_000);
}
