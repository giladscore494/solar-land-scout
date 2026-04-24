import test from "node:test";
import assert from "node:assert/strict";
import { getParcelEngineFallbackReason, resolveParcelEngineAvailability } from "@/lib/db/health";
import { selectAnalyzeStateEngine } from "@/lib/agent/scan-engine";

test("parcel engine stays enabled when scanner/unified parcels exist for the state", () => {
  const availability = resolveParcelEngineAvailability({
    stateCode: "AZ",
    legacyParcelsForState: 0,
    unifiedParcelsForState: 12,
    scannerParcelsForState: 12,
    legacyParcelsTotal: 0,
    unifiedParcelsTotal: 12,
    scannerRelation: "scanner_parcels",
    baseUsable: true,
    reason: "PARCEL_STATE_EMPTY",
  });

  const health = {
    ok: availability.parcelEngineUsable,
    database_connected: true,
    postgis_available: true,
    selected_url_env: "SUPABASE_DATABASE_URL" as const,
    required_tables: {
      parcels: true,
      transmission_lines: true,
      substations: true,
      protected_areas: true,
      flood_zones: true,
    },
    missing_tables: [],
    missing_columns: {},
    blocking_missing_columns: {},
    optional_missing_columns: {},
    missing_indexes: [],
    counts: {
      parcels_total: 0,
      parcels_for_state: availability.effectiveParcelsForState,
      unified_parcels_total: 12,
      unified_parcels_for_state: 12,
      transmission_lines_total: 1,
      substations_total: 1,
      protected_areas_total: 1,
      flood_zones_total: 1,
    },
    warnings: [],
    reason: availability.reason,
    elapsed_ms: 0,
    legacy_parcels_for_state: 0,
    unified_parcels_for_state: 12,
    scanner_parcels_for_state: 12,
    effective_parcels_for_state: availability.effectiveParcelsForState,
    scanner_relation: "scanner_parcels" as const,
    parcel_engine_usable: availability.parcelEngineUsable,
    parcel_coverage: null,
  };

  assert.equal(health.ok, true);
  assert.equal(health.parcel_engine_usable, true);
  assert.equal(getParcelEngineFallbackReason(health), null);
  assert.equal(selectAnalyzeStateEngine("parcel", health), "parcel");
});

test("parcel engine falls back to grid when no parcel rows exist for the state", () => {
  const availability = resolveParcelEngineAvailability({
    stateCode: "AZ",
    legacyParcelsForState: 0,
    unifiedParcelsForState: 0,
    scannerParcelsForState: 0,
    legacyParcelsTotal: 0,
    unifiedParcelsTotal: 0,
    scannerRelation: "scanner_parcels",
    baseUsable: true,
    reason: null,
  });

  const health = {
    ok: availability.parcelEngineUsable,
    database_connected: true,
    postgis_available: true,
    selected_url_env: "SUPABASE_DATABASE_URL" as const,
    required_tables: {
      parcels: true,
      transmission_lines: true,
      substations: true,
      protected_areas: true,
      flood_zones: true,
    },
    missing_tables: [],
    missing_columns: {},
    blocking_missing_columns: {},
    optional_missing_columns: {},
    missing_indexes: [],
    counts: {
      parcels_total: 0,
      parcels_for_state: availability.effectiveParcelsForState,
      unified_parcels_total: 0,
      unified_parcels_for_state: 0,
      transmission_lines_total: 1,
      substations_total: 1,
      protected_areas_total: 1,
      flood_zones_total: 1,
    },
    warnings: [],
    reason: availability.reason,
    elapsed_ms: 0,
    legacy_parcels_for_state: 0,
    unified_parcels_for_state: 0,
    scanner_parcels_for_state: 0,
    effective_parcels_for_state: availability.effectiveParcelsForState,
    scanner_relation: "scanner_parcels" as const,
    parcel_engine_usable: availability.parcelEngineUsable,
    parcel_coverage: null,
  };

  assert.equal(health.ok, false);
  assert.equal(health.parcel_engine_usable, false);
  assert.equal(getParcelEngineFallbackReason(health), "PARCEL_STATE_EMPTY");
  assert.equal(selectAnalyzeStateEngine("parcel", health), "grid");
});
