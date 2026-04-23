import type { ScanEvent } from "@/types/scan-events";
import { getPostGISPool } from "@/lib/postgis";
import { buildGridForState } from "./grid";
import { getStateBbox } from "./state-bbox";
import { scoreParcel } from "./parcel-scorer";
import type { ParcelMetrics } from "./parcel-scorer";
import type { ScanOptions, ScanResult } from "./run-scan";
import { createAnalysisRun, completeAnalysisRun } from "@/lib/analysis-runs";
import type { CandidateSite } from "@/types/domain";

// NASA POWER endpoint for GHI
const NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point";

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
      signal: AbortSignal.timeout(8_000),
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

async function findHotZones(stateCode: string, signal?: AbortSignal): Promise<HotZone[]> {
  // Use coarse 25km grid to find areas with GHI >= 5.0
  const allCells = buildGridForState(stateCode, 25);
  const hotZones: HotZone[] = [];
  const GHI_THRESHOLD = 5.0;

  for (const cell of allCells) {
    if (signal?.aborted) break;
    const centerLat = (cell.bboxDeg[1] + cell.bboxDeg[3]) / 2;
    const centerLng = (cell.bboxDeg[0] + cell.bboxDeg[2]) / 2;
    const ghi = await fetchGHI(centerLat, centerLng);
    if (ghi !== null && ghi >= GHI_THRESHOLD) {
      hotZones.push({ bbox: cell.bboxDeg, ghi });
    }
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  return hotZones;
}

function distanceToInfraProximity(distKm: number | null): "near" | "moderate" | "far" {
  if (distKm === null) return "far";
  if (distKm < 5) return "near";
  if (distKm < 15) return "moderate";
  return "far";
}

export async function runParcelScan(
  stateCode: string,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  const { signal, onEvent } = opts;
  const emit = onEvent ?? (() => undefined);

  const pool = await getPostGISPool();
  if (!pool) {
    throw new Error("Parcel engine requires SUPABASE_DATABASE_URL to be configured");
  }

  const run = await createAnalysisRun(stateCode, "en");
  const bbox = getStateBbox(stateCode);
  const bboxArr: [number, number, number, number] = [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];

  emit({ type: "scan_started", stateCode, totalCells: 0, bbox: bboxArr, at: new Date().toISOString() });

  const passedSites: CandidateSite[] = [];
  const rejected_by: Record<string, number> = {};
  let processed = 0;
  let total = 0;

  try {
    // Stage 1: Find hot zones
    const hotZones = await findHotZones(stateCode, signal);

    emit({
      type: "hot_zone_identified",
      count: hotZones.length,
      stateCode,
      at: new Date().toISOString(),
    } as ScanEvent);

    // Stage 2: Query parcels in hot zones
    for (const zone of hotZones) {
      if (signal?.aborted) break;

      const [minLng, minLat, maxLng, maxLat] = zone.bbox;

      // Query parcels within this hot zone bbox
      const parcelResult = (await pool.query(
        `SELECT id, apn, source, source_id, state_code, county_fips, owner_type, owner_name, acres,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001)) AS geom_json,
                ST_X(centroid) AS lng, ST_Y(centroid) AS lat,
                ST_Area(geom::geography) / 4046.86 AS computed_acres
         FROM parcels
         WHERE ST_Intersects(bbox, ST_MakeEnvelope($1, $2, $3, $4, 4326))
           AND state_code = $5
         LIMIT 1000`,
        [minLng, minLat, maxLng, maxLat, stateCode]
      )) as {
        rows: Array<{
          id: number;
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

      total += parcelResult.rows.length;

      for (const parcel of parcelResult.rows) {
        if (signal?.aborted) break;
        processed++;

        emit({
          type: "parcel_evaluated",
          parcelId: String(parcel.id),
          apn: parcel.apn,
          stateCode: parcel.state_code,
          at: new Date().toISOString(),
        } as ScanEvent);

        // Compute metrics using PostGIS
        const metricsResult = (await pool.query(
          `SELECT
            -- Protected area check
            EXISTS(
              SELECT 1 FROM protected_areas pa
              WHERE ST_Intersects(pa.geom, (SELECT geom FROM parcels WHERE id=$1))
              LIMIT 1
            ) AS in_protected_area,
            (SELECT pa.name FROM protected_areas pa
             WHERE ST_Intersects(pa.geom, (SELECT geom FROM parcels WHERE id=$1))
             LIMIT 1) AS protected_area_name,
            -- Flood zone check (SFHA only)
            EXISTS(
              SELECT 1 FROM flood_zones fz
              WHERE fz.sfha = true
                AND ST_Intersects(fz.geom, (SELECT geom FROM parcels WHERE id=$1))
              LIMIT 1
            ) AS in_flood_zone,
            (SELECT fz.flood_zone FROM flood_zones fz
             WHERE fz.sfha = true
               AND ST_Intersects(fz.geom, (SELECT geom FROM parcels WHERE id=$1))
             LIMIT 1) AS flood_zone_code,
            -- Transmission distance
            (SELECT ST_Distance(tl.geom::geography, (SELECT centroid::geography FROM parcels WHERE id=$1)) / 1000.0
             FROM transmission_lines tl
             ORDER BY tl.geom <-> (SELECT centroid FROM parcels WHERE id=$1)
             LIMIT 1) AS distance_to_transmission_km,
            (SELECT tl.voltage_kv
             FROM transmission_lines tl
             ORDER BY tl.geom <-> (SELECT centroid FROM parcels WHERE id=$1)
             LIMIT 1) AS nearest_transmission_kv,
            -- Substation distance
            (SELECT ST_Distance(s.geom::geography, (SELECT centroid::geography FROM parcels WHERE id=$1)) / 1000.0
             FROM substations s
             ORDER BY s.geom <-> (SELECT centroid FROM parcels WHERE id=$1)
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

        const metrics: ParcelMetrics = {
          total_acres: totalAcres,
          usable_acres: totalAcres * 0.8,
          contiguous_usable_acres: totalAcres * 0.7,
          shape_regularity: 0.7,
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
              parcel.id,
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
          };

          passedSites.push(site);

          emit({
            type: "parcel_passed",
            parcelId: String(parcel.id),
            apn: parcel.apn,
            score: scored.overall_score,
            geojson: parcel.geom_json,
            stateCode: parcel.state_code,
            at: new Date().toISOString(),
          } as ScanEvent);
        } else {
          emit({
            type: "parcel_rejected",
            parcelId: String(parcel.id),
            reason: scored.rejection_reason ?? "unknown",
            stateCode: parcel.state_code,
            at: new Date().toISOString(),
          } as ScanEvent);
        }
      }
    }

    if (run) {
      try {
        await completeAnalysisRun(run.id, "completed", `Parcel scan: ${processed} parcels, ${passedSites.length} passed`, null);
      } catch {
        // non-fatal
      }
    }

    emit({
      type: "scan_completed",
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
    const msg = error instanceof Error ? error.message : "scan_failed";
    if (run) {
      try {
        await completeAnalysisRun(run.id, "failed", msg, null);
      } catch {
        // non-fatal
      }
    }
    emit({ type: "scan_error", message: msg, at: new Date().toISOString() });
    throw error;
  }
}
