import test from "node:test";
import assert from "node:assert/strict";
import { getParcelEngineFallbackReason, resolveParcelEngineAvailability } from "@/lib/db/health";
import { selectAnalyzeStateEngine } from "@/lib/agent/scan-engine";

test("parcel engine stays enabled when scanner/unified parcels exist for the state", () => {
  const availability = resolveParcelEngineAvailability({
    stateCode: "AZ",
    rawFeaturesForState: 12,
    legacyParcelsForState: 0,
    unifiedParcelsForState: 12,
    scannerParcelsForState: 12,
    legacyParcelsTotal: 0,
    unifiedParcelsTotal: 12,
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
    raw_features_for_state: 12,
    unified_parcels_for_state: 12,
    scanner_parcels_for_state: 12,
    effective_parcels_for_state: availability.effectiveParcelsForState,
    scanner_relation: availability.scannerRelation,
    parcel_engine_usable: availability.parcelEngineUsable,
    next_action_message: availability.nextActionMessage,
    parcel_coverage: null,
  };

  assert.equal(health.ok, true);
  assert.equal(health.parcel_engine_usable, true);
   assert.equal(health.scanner_relation, "scanner_parcels");
  assert.equal(health.next_action_message, "Parcel engine is usable.");
  assert.equal(getParcelEngineFallbackReason(health), null);
  assert.equal(selectAnalyzeStateEngine("parcel", health), "parcel");
});

test("parcel engine falls back to grid when no parcel rows exist for the state", () => {
  const availability = resolveParcelEngineAvailability({
    stateCode: "AZ",
    rawFeaturesForState: 0,
    legacyParcelsForState: 0,
    unifiedParcelsForState: 0,
    scannerParcelsForState: 0,
    legacyParcelsTotal: 0,
    unifiedParcelsTotal: 0,
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
    raw_features_for_state: 0,
    unified_parcels_for_state: 0,
    scanner_parcels_for_state: 0,
    effective_parcels_for_state: availability.effectiveParcelsForState,
    scanner_relation: availability.scannerRelation,
    parcel_engine_usable: availability.parcelEngineUsable,
    next_action_message: availability.nextActionMessage,
    parcel_coverage: null,
  };

  assert.equal(health.ok, false);
  assert.equal(health.parcel_engine_usable, false);
  assert.equal(getParcelEngineFallbackReason(health), "PARCEL_STATE_EMPTY");
  assert.equal(selectAnalyzeStateEngine("parcel", health), "grid");
  assert.equal(health.next_action_message, "Run import:parcels:az, then parcels:unify.");
});

test("raw parcel features without unified rows report unification failure", () => {
  const availability = resolveParcelEngineAvailability({
    stateCode: "AZ",
    rawFeaturesForState: 24,
    legacyParcelsForState: 0,
    unifiedParcelsForState: 0,
    scannerParcelsForState: 0,
    legacyParcelsTotal: 0,
    unifiedParcelsTotal: 0,
    baseUsable: true,
    reason: null,
  });

  assert.equal(availability.parcelEngineUsable, false);
  assert.equal(availability.reason, "PARCEL_UNIFY_NOT_RUN_OR_FAILED");
  assert.equal(
    availability.nextActionMessage,
    "Raw parcel features exist, but unification has not produced scanner parcels. Run parcels:unify and inspect errors."
  );
});

test("unified parcels without scanner rows report broken scanner relation", () => {
  const availability = resolveParcelEngineAvailability({
    stateCode: "AZ",
    rawFeaturesForState: 24,
    legacyParcelsForState: 0,
    unifiedParcelsForState: 18,
    scannerParcelsForState: 0,
    legacyParcelsTotal: 0,
    unifiedParcelsTotal: 18,
    baseUsable: true,
    reason: null,
  });

  assert.equal(availability.parcelEngineUsable, false);
  assert.equal(availability.reason, "SCANNER_PARCELS_VIEW_EMPTY_OR_BROKEN");
  assert.equal(
    availability.nextActionMessage,
    "Unified parcels exist, but scanner_parcels view is empty or broken. Check migration/view definition."
  );
});
