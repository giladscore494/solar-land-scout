import { getPostGISPool } from "@/lib/postgis";
import { getMaxHotzoneCells, getNasaPowerTimeoutMs, getPostgisQueryTimeoutMs } from "@/lib/db/spatial-config";
import { buildGridForState } from "./grid";
import { getStateBbox } from "./state-bbox";
import { scoreParcel } from "./parcel-scorer";
import type { ParcelMetrics } from "./parcel-scorer";
import type { ScanOptions, ScanResult } from "./run-scan";
import { createAnalysisRun, completeAnalysisRun, saveCandidateSites } from "@/lib/analysis-runs";
import type { CandidateSite } from "@/types/domain";
import type { Geometry } from "geojson";
import type { HotZoneProgressEvent } from "@/types/scan-events";
import { detectScannerParcelRelation } from "@/lib/importers/parcel-db";

// NASA POWER endpoint for GHI
const NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point";
const DAYS_PER_YEAR = 365;
const GHI_ROUNDING_FACTOR = 10;
const HOTZONE_CELL_DELAY_MS = 50;
const GHI_THRESHOLD = 5.0;

async function fetchGHI(lat: number, lng: number): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      parameters: "ALLSKY_SFC_SW_DWN",
      community: "RE",
      longitude: lng.toFixed(4),
      latitude: lat.toFixed(4),
      format: "JSON",
    });
    const res = await fetch(`${NASA_POWER_URL}?${params}`, {
      signal: AbortSignal.timeout(getNasaPowerTimeoutMs()),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      properties?: { parameter?: { ALLSKY_SFC_SW_DWN?: Record<string, number> } };
    };
    const vals = data.properties?.parameter?.ALLSKY_SFC_SW_DWN;
    if (!vals) return null;
    const ann = vals["ANN"];
    return typeof ann === "number" ? ann : null;
  } catch {
    return null;
  }
}

interface HotZone {
  bbox: [number, number, number, number];
  ghi: number;
}

interface HotZoneDiscovery {
  hotZones: HotZone[];
  failedRequests: number;
  totalCells: number;
}

async function findHotZones(
  stateCode: string,
  signal?: AbortSignal,
  onProgress?: (progress: HotZoneProgressEvent) => void
): Promise<HotZoneDiscovery> {
  const allCells = buildGridForState(stateCode, 25).slice(0, getMaxHotzoneCells());
  const hotZones: HotZone[] = [];
  let failedRequests = 0;
  const started = Date.now();

  onProgress?.({
    planned: allCells.length,
    scanned: 0,
    elapsed_ms: 0,
  });

  for (const [index, cell] of allCells.entries()) {
    if (signal?.aborted) break;
    const centerLat = (cell.bboxDeg[1] + cell.bboxDeg[3]) / 2;
    const centerLng = (cell.bboxDeg[0] + cell.bboxDeg[2]) / 2;
    const ghi = await fetchGHI(centerLat, centerLng);
    if (ghi === null) {
      failedRequests++;
    }
    if (ghi !== null && ghi >= GHI_THRESHOLD) {
      hotZones.push({ bbox: cell.bboxDeg, ghi });
    }
    onProgress?.({
      planned: allCells.length,
      scanned: index + 1,
      current_bbox: cell.bboxDeg,
      current_lat: centerLat,
      current_lng: centerLng,
      current_ghi: ghi,
      elapsed_ms: Date.now() - started,
    });
    await new Promise((r) => setTimeout(r, HOTZONE_CELL_DELAY_MS));
  }

  return { hotZones, failedRequests, totalCells: allCells.length };
}

function distanceToInfraProximity(distKm: number | null): "near" | "moderate" | "far" {
  if (distKm === null) return "far";
  if (distKm < 5) return "near";
  if (distKm < 15) return "moderate";
  return "far";
}

function normalizeParcelError(error: unknown): Error {
  const timeoutMs = getPostgisQueryTimeoutMs();
  if (error instanceof Error && error.message.toLowerCase().includes("timeout")) {
    return new Error(`Parcel query timed out after ${timeoutMs}ms`);
  }
  if (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "57014"
  ) {
    return new Error(`Parcel query timed out after ${timeoutMs}ms`);
  }
  return error instanceof Error ? error : new Error("parcel_failed");
}

export async function runParcelScan(
  stateCode: string,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  const { signal, onEvent, requestedEngine, fallbackReason, dbHealth } = opts;
  const emit = onEvent ?? (() => undefined);
  const scanContext = {
    requestedEngine,
    fallbackReason,
    db_health: dbHealth,
  };

  const pool = await getPostGISPool();
  if (!pool) {
    throw new Error(
      "Parcel engine requires SUPABASE_DATABASE_URL or DATABASE_URL to be configured (prefers SUPABASE_DATABASE_URL when both are set)"
    );
  }

  const run = await createAnalysisRun(stateCode, "en");
  const bbox = getStateBbox(stateCode);
  const bboxArr: [number, number, number, number] = [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];
  const parcelRelation = await detectScannerParcelRelation(pool, stateCode);

  const passedSites: CandidateSite[] = [];
  const rejected_by: Record<string, number> = {};
  let processed = 0;
  let total = 0;
  let rejected = 0;

  // Heartbeat state
  let currentStage = "initializing";
  let currentActivity = `Starting parcel scan for ${stateCode}`;
  const scanStart = Date.now();

  emit({
    type: "scan_started",
    engine: "parcel",
    ...scanContext,
    stateCode,
    totalParcels: 0,
    processed: 0,
    passed: 0,
    rejected: 0,
    currentStage,
    bbox: bboxArr,
    at: new Date().toISOString(),
  });

  const heartbeatTimer = setInterval(() => {
    if (signal?.aborted) return;
    emit({
      type: "scan_heartbeat",
      engine: "parcel",
      stage: currentStage,
      activity: currentActivity,
      ...scanContext,
      processed,
      total,
      elapsed_ms: Date.now() - scanStart,
      at: new Date().toISOString(),
    });
  }, 1000);

  try {
    // Stage 1: Find hot zones
    currentStage = "finding_hot_zones";
    currentActivity = `Identifying high-GHI hot zones for ${stateCode} via NASA POWER`;
    const hotZoneDiscovery = await findHotZones(stateCode, signal, (progress) => {
      processed = progress.scanned;
      total = progress.planned;
      currentActivity = `Checking NASA POWER ${progress.scanned}/${progress.planned} hot-zone cells`;
      emit({
        type: "scan_heartbeat",
        engine: "parcel",
        stage: currentStage,
        activity: currentActivity,
        ...scanContext,
        hotzone_progress: progress,
        processed,
        total,
        elapsed_ms: Date.now() - scanStart,
        at: new Date().toISOString(),
      });
    });
    const hotZones = hotZoneDiscovery.hotZones;
    if (hotZoneDiscovery.totalCells === 0) {
      currentActivity = `No hot-zone cells available for ${stateCode}`;
    } else if (hotZoneDiscovery.failedRequests === hotZoneDiscovery.totalCells) {
      currentActivity = `NASA POWER unavailable for all ${hotZoneDiscovery.totalCells} sampled cells`;
    } else if (hotZones.length === 0) {
      currentActivity = `No sampled cells met the GHI threshold across ${hotZoneDiscovery.totalCells} hot-zone checks`;
    } else {
      currentActivity = `Identified ${hotZones.length} hot zone(s) from ${hotZoneDiscovery.totalCells} sampled cells`;
    }

    // Stage 2: Query parcels in hot zones
    currentStage = "querying_parcels";
    currentActivity = `Querying parcels in ${hotZones.length} hot zone(s)`;
    processed = 0;
    total = hotZones.length;
    const parcelsById = new Map<
      string,
      {
        id: string;
        apn: string | null;
        source: string;
        source_id: string;
        state_code: string;
        county_fips: string | null;
        owner_type: string | null;
        owner_name: string | null;
        acres: number | null;
        geom_json: string;
        lng: number;
        lat: number;
        computed_acres: number;
      }
    >();

    for (const [index, zone] of hotZones.entries()) {
      if (signal?.aborted) break;
      processed = index + 1;

      const [minLng, minLat, maxLng, maxLat] = zone.bbox;

      // Query parcels within this hot zone bbox
      const parcelResult = (await pool.query(
        `SELECT id, apn, source, source_id, state_code, county_fips, owner_type, owner_name, acres,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001)) AS geom_json,
                ST_X(centroid) AS lng, ST_Y(centroid) AS lat,
                ST_Area(geom::geography) / 4046.86 AS computed_acres
         FROM ${parcelRelation}
          WHERE ST_Intersects(bbox, ST_MakeEnvelope($1, $2, $3, $4, 4326))
            AND state_code = $5
          LIMIT 1000`,
        [minLng, minLat, maxLng, maxLat, stateCode]
      )) as {
        rows: Array<{
           id: string;
          apn: string | null;
          source: string;
          source_id: string;
          state_code: string;
          county_fips: string | null;
          owner_type: string | null;
          owner_name: string | null;
          acres: number | null;
          geom_json: string;
          lng: number;
          lat: number;
          computed_acres: number;
        }>;
      };

      for (const parcel of parcelResult.rows) {
        const idString = String(parcel.id);
        parcelsById.set(idString, { ...parcel, id: idString });
      }

      currentActivity = `Collected ${parcelsById.size} unique parcels from ${index + 1}/${hotZones.length} hot zone(s)`;
    }

    processed = 0;
    total = parcelsById.size;
    currentStage = "evaluating_parcels";
    currentActivity = `Evaluating 0/${total} parcels — 0 passed`;
    emit({
      type: "scan_started",
      engine: "parcel",
      ...scanContext,
      stateCode,
      totalParcels: total,
      processed: 0,
      passed: 0,
      rejected: 0,
      currentStage,
      bbox: bboxArr,
      at: new Date().toISOString(),
    });
    emit({
      type: "tally_update",
      engine: "parcel",
      rejected_by: { ...rejected_by },
      passed: 0,
      rejected: 0,
      processed: 0,
      total,
    });

    for (const parcel of parcelsById.values()) {
      if (signal?.aborted) break;
      processed++;
      currentActivity = `Evaluating parcel ${processed}/${total} (APN: ${parcel.apn ?? parcel.id}) — ${passedSites.length} passed`;
      const centroid = { lat: parcel.lat, lng: parcel.lng };
      const geometry = safeParseGeometry(parcel.geom_json);

      try {
        // Compute metrics using PostGIS
        const metricsResult = (await pool.query(
          `SELECT
            -- Protected area check
             EXISTS(
               SELECT 1 FROM protected_areas pa
               WHERE ST_Intersects(pa.geom, (SELECT geom FROM ${parcelRelation} WHERE id=$1))
               LIMIT 1
             ) AS in_protected_area,
             (SELECT pa.name FROM protected_areas pa
             WHERE ST_Intersects(pa.geom, (SELECT geom FROM ${parcelRelation} WHERE id=$1))
              LIMIT 1) AS protected_area_name,
             -- Flood zone check (SFHA only)
             EXISTS(
               SELECT 1 FROM flood_zones fz
                WHERE fz.sfha = true
                AND ST_Intersects(fz.geom, (SELECT geom FROM ${parcelRelation} WHERE id=$1))
               LIMIT 1
             ) AS in_flood_zone,
             (SELECT fz.flood_zone FROM flood_zones fz
              WHERE fz.sfha = true
               AND ST_Intersects(fz.geom, (SELECT geom FROM ${parcelRelation} WHERE id=$1))
              LIMIT 1) AS flood_zone_code,
             -- Transmission distance
             (SELECT ST_Distance(tl.geom::geography, (SELECT centroid::geography FROM ${parcelRelation} WHERE id=$1)) / 1000.0
              FROM transmission_lines tl
              ORDER BY tl.geom <-> (SELECT centroid FROM ${parcelRelation} WHERE id=$1)
              LIMIT 1) AS distance_to_transmission_km,
             (SELECT tl.voltage_kv
              FROM transmission_lines tl
              ORDER BY tl.geom <-> (SELECT centroid FROM ${parcelRelation} WHERE id=$1)
              LIMIT 1) AS nearest_transmission_kv,
             -- Substation distance
             (SELECT ST_Distance(s.geom::geography, (SELECT centroid::geography FROM ${parcelRelation} WHERE id=$1)) / 1000.0
              FROM substations s
              ORDER BY s.geom <-> (SELECT centroid FROM ${parcelRelation} WHERE id=$1)
              LIMIT 1) AS distance_to_substation_km`,
          [parcel.id]
        )) as {
          rows: Array<{
            in_protected_area: boolean;
            protected_area_name: string | null;
            in_flood_zone: boolean;
            flood_zone_code: string | null;
            distance_to_transmission_km: number | null;
            nearest_transmission_kv: number | null;
            distance_to_substation_km: number | null;
          }>;
        };

        const spatialMetrics = metricsResult.rows[0];
        const totalAcres = parcel.acres ?? parcel.computed_acres;
        const ghi = await fetchGHI(parcel.lat, parcel.lng);
        const annualGhi = toAnnualGhi(ghi);

        const metrics: ParcelMetrics = {
          total_acres: totalAcres,
          // TODO: compute via ST_Difference(geom, UNION(wetlands, flood_sfha, road_buffer_30m))
          usable_acres: totalAcres * 0.8,
          // TODO: compute via ST_Area(ST_LargestPart(usable_geom))
          contiguous_usable_acres: totalAcres * 0.7,
          // TODO: compute via 4*PI()*area / perimeter^2
          shape_regularity: 0.7,
          // TODO: sample USGS elevation at 9 points, derive mean+stddev slope
          mean_slope_percent: 2.0,
          slope_stddev_percent: 1.0,
          in_protected_area: spatialMetrics?.in_protected_area ?? false,
          protected_area_name: spatialMetrics?.protected_area_name ?? null,
          in_flood_zone: spatialMetrics?.in_flood_zone ?? false,
          flood_zone_code: spatialMetrics?.flood_zone_code ?? null,
          wetlands_pct: 0,
          distance_to_transmission_km: spatialMetrics?.distance_to_transmission_km ?? null,
          nearest_transmission_kv: spatialMetrics?.nearest_transmission_kv ?? null,
          distance_to_substation_km: spatialMetrics?.distance_to_substation_km ?? null,
          distance_to_road_km: null,
          ghi_kwh_m2_day: ghi,
        };

        const scored = scoreParcel(metrics);
        const rejectionKey = scored.rejection_reason ?? "passed";
        rejected_by[rejectionKey] = (rejected_by[rejectionKey] ?? 0) + 1;

        // Save to parcel_scores
        try {
          if (parcelRelation === "parcels") {
            await pool.query(
            `INSERT INTO parcel_scores (
              parcel_id, run_id, total_acres, usable_acres, contiguous_usable_acres,
              shape_regularity, mean_slope_percent, slope_stddev_percent,
              in_protected_area, protected_area_name, in_flood_zone, flood_zone_code,
              wetlands_pct, distance_to_transmission_km, nearest_transmission_kv,
              distance_to_substation_km, distance_to_road_km, ghi_kwh_m2_day,
              overall_score, passes_strict_filters, rejection_reason, computed_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
            ON CONFLICT (parcel_id, run_id) DO UPDATE
              SET overall_score = EXCLUDED.overall_score,
                  passes_strict_filters = EXCLUDED.passes_strict_filters,
                  rejection_reason = EXCLUDED.rejection_reason,
                  computed_at = NOW()`,
            [
              Number(parcel.id),
              run?.id ?? null,
              metrics.total_acres,
              metrics.usable_acres,
              metrics.contiguous_usable_acres,
              metrics.shape_regularity,
              metrics.mean_slope_percent,
              metrics.slope_stddev_percent,
              metrics.in_protected_area,
              metrics.protected_area_name,
              metrics.in_flood_zone,
              metrics.flood_zone_code,
              metrics.wetlands_pct,
              metrics.distance_to_transmission_km,
              metrics.nearest_transmission_kv,
              metrics.distance_to_substation_km,
              metrics.distance_to_road_km,
              metrics.ghi_kwh_m2_day,
              scored.overall_score,
              scored.passes_strict_filters,
              scored.rejection_reason,
            ]
            );
          }
        } catch {
          // non-fatal
        }

        if (scored.passes_strict_filters) {
          const site: CandidateSite = {
            id: `parcel_${parcel.id}`,
            state_code: parcel.state_code,
            state_name: stateCode,
            title: parcel.apn ? `APN ${parcel.apn}` : `Parcel ${parcel.id}`,
            lat: parcel.lat,
            lng: parcel.lng,
            solar_resource_value: metrics.ghi_kwh_m2_day ?? 0,
            estimated_land_cost_band: "moderate",
            distance_to_infra_estimate: distanceToInfraProximity(metrics.distance_to_transmission_km),
            slope_estimate: metrics.mean_slope_percent,
            open_land_score: 70,
            passes_strict_filters: true,
            qualification_reasons: [
              `${metrics.contiguous_usable_acres.toFixed(0)} contiguous usable acres`,
              `GHI ${metrics.ghi_kwh_m2_day?.toFixed(1) ?? "N/A"} kWh/m²/day`,
              metrics.distance_to_transmission_km
                ? `Transmission ${metrics.distance_to_transmission_km.toFixed(1)} km`
                : "Transmission proximity OK",
            ],
            caution_notes: [],
            overall_site_score: scored.overall_score,
            gemini_summary_seed: "",
            in_protected_area: metrics.in_protected_area,
            in_flood_zone: metrics.in_flood_zone,
            flood_zone: metrics.flood_zone_code,
            distance_to_infra_km: metrics.distance_to_transmission_km,
            annual_ghi_kwh_m2: annualGhi,
            contiguous_acres: metrics.contiguous_usable_acres,
            slope_pct: metrics.mean_slope_percent,
          };

          passedSites.push(site);

          emit({
            type: "parcel_result",
            engine: "parcel",
            parcelId: String(parcel.id),
            status: "passed",
            score: scored.overall_score,
            geometry,
            centroid,
            properties: {
              apn: parcel.apn,
              source: parcel.source,
              source_id: parcel.source_id,
              state_code: parcel.state_code,
              county_fips: parcel.county_fips,
              owner_type: parcel.owner_type,
              owner_name: parcel.owner_name,
              acres: totalAcres,
              ghi_kwh_m2_day: metrics.ghi_kwh_m2_day,
              nearest_transmission_kv: metrics.nearest_transmission_kv,
              distance_to_transmission_km: metrics.distance_to_transmission_km,
              distance_to_substation_km: metrics.distance_to_substation_km,
            },
            site,
            processed,
            passed: passedSites.length,
            rejected,
            total,
            totalParcels: total,
            currentStage,
            at: new Date().toISOString(),
          });
        } else {
          rejected++;
          emit({
            type: "parcel_result",
            engine: "parcel",
            parcelId: String(parcel.id),
            status: "rejected",
            score: scored.overall_score,
            reason: scored.rejection_reason ?? "unknown",
            geometry,
            centroid,
            properties: {
              apn: parcel.apn,
              source: parcel.source,
              source_id: parcel.source_id,
              state_code: parcel.state_code,
              county_fips: parcel.county_fips,
              acres: totalAcres,
              ghi_kwh_m2_day: metrics.ghi_kwh_m2_day,
            },
            processed,
            passed: passedSites.length,
            rejected,
            total,
            totalParcels: total,
            currentStage,
            at: new Date().toISOString(),
          });
        }
      } catch (error) {
        rejected++;
        const normalizedError = normalizeParcelError(error);
        const reason = normalizedError.message;
        rejected_by.parcel_error = (rejected_by.parcel_error ?? 0) + 1;
        emit({
          type: "parcel_result",
          engine: "parcel",
          parcelId: String(parcel.id),
          status: "error",
          reason,
          geometry,
          centroid,
          properties: {
            apn: parcel.apn,
            source: parcel.source,
            source_id: parcel.source_id,
            state_code: parcel.state_code,
            county_fips: parcel.county_fips,
          },
          processed,
          passed: passedSites.length,
          rejected,
          total,
          totalParcels: total,
          currentStage,
          at: new Date().toISOString(),
        });
      }

      if (processed % 10 === 0 || processed === total) {
        emit({
          type: "tally_update",
          engine: "parcel",
          rejected_by: { ...rejected_by },
          passed: passedSites.length,
          rejected,
          processed,
          total,
        });
      }
    }

    currentStage = "persisting_results";
    currentActivity = `Saving ${passedSites.length} parcel candidates`;
    if (run && passedSites.length > 0) {
      try {
        await saveCandidateSites(run.id, passedSites.map((site) => ({ ...site, run_id: run.id })));
      } catch {
        // non-fatal
      }
    }

    if (run) {
      currentStage = "finalizing";
      currentActivity = `Finalizing: ${processed} parcels evaluated, ${passedSites.length} passed`;
      try {
        await completeAnalysisRun(run.id, "completed", `Parcel scan: ${processed} parcels, ${passedSites.length} passed`, null);
      } catch {
        // non-fatal
      }
    }

    emit({
      type: "scan_completed",
      engine: "parcel",
      ...scanContext,
      runId: run?.id ?? null,
      passed: passedSites.length,
      total,
      rejected_by,
      at: new Date().toISOString(),
    });

    return {
      runId: run?.id ?? null,
      stateCode,
      passed: passedSites.length,
      total,
      rejected_by,
      sites: passedSites,
    };
  } catch (error) {
    const cancelled = signal?.aborted ?? false;
    const normalizedError = normalizeParcelError(error);
    const msg = cancelled
      ? "scan_cancelled"
      : normalizedError.message;
    if (run) {
      try {
        await completeAnalysisRun(run.id, cancelled ? "cancelled" : "failed", msg, null);
      } catch {
        // non-fatal
      }
    }
    emit({
      type: "scan_error",
      engine: "parcel",
      ...scanContext,
      message: msg,
      stage: currentStage,
      cancelled,
      at: new Date().toISOString(),
    });
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function safeParseGeometry(value: string): Geometry | undefined {
  try {
    const parsed = JSON.parse(value);
    return isGeometry(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toAnnualGhi(ghiKwhM2Day: number | null): number | null {
  if (ghiKwhM2Day === null) return null;
  return Math.round(ghiKwhM2Day * DAYS_PER_YEAR * GHI_ROUNDING_FACTOR) / GHI_ROUNDING_FACTOR;
}

function isGeometry(value: unknown): value is Geometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  switch (geometry.type) {
    case "Point":
    case "MultiPoint":
    case "LineString":
    case "MultiLineString":
    case "Polygon":
    case "MultiPolygon":
      return "coordinates" in geometry;
    case "GeometryCollection":
      return Array.isArray(geometry.geometries);
    default:
      return false;
  }
}
