export type SelectedDbUrlEnv = "SUPABASE_DATABASE_URL" | "DATABASE_URL" | null;
export type DatabaseUrlKind = "pooler" | "direct" | "unknown" | null;

export interface DbHealthCounts {
  parcels_total: number;
  parcels_for_state: number | null;
  transmission_lines_total: number;
  substations_total: number;
  protected_areas_total: number;
  flood_zones_total: number;
}

export interface DbHealthResult {
  ok: boolean;
  database_connected: boolean;
  postgis_available: boolean;
  selected_url_env: SelectedDbUrlEnv;
  required_tables: {
    parcels: boolean;
    transmission_lines: boolean;
    substations: boolean;
    protected_areas: boolean;
    flood_zones: boolean;
  };
  missing_tables: string[];
  missing_columns: Record<string, string[]>;
  blocking_missing_columns: Record<string, string[]>;
  optional_missing_columns: Record<string, string[]>;
  missing_indexes: string[];
  counts: DbHealthCounts;
  warnings: string[];
  reason: string | null;
  elapsed_ms: number;
  url_kind?: DatabaseUrlKind;
  step_elapsed_ms?: Record<string, number>;
}

export interface ScanDbHealthSummary {
  selected_url_env: SelectedDbUrlEnv;
  database_connected: boolean;
  postgis_available: boolean;
  missing_tables: string[];
  missing_columns: Record<string, string[]>;
  blocking_missing_columns: Record<string, string[]>;
  optional_missing_columns: Record<string, string[]>;
  missing_indexes: string[];
  parcels_for_state: number | null;
  warnings: string[];
  reason: string | null;
}
