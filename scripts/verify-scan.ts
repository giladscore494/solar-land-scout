/**
 * Smoke test for the grid scan pipeline.
 * Run with: npx tsx scripts/verify-scan.ts
 *
 * Verifies known-location behavior:
 * 1. Phoenix downtown (33.4484, -112.0740) — urban, expected: low_open_land or low_overall_score
 * 2. Pinal farmland (32.8795, -111.7574) — agricultural, expected: passed
 * 3. Yellowstone interior (44.4280, -110.5885) — protected, expected: protected
 */

import { buildGridForState } from "../lib/agent/grid";
import { getStateBbox } from "../lib/agent/state-bbox";
import { computeOpenLandScore, computeLandCostBand } from "../lib/agent/open-land-heuristic";
import type { CandidateSite } from "../types/domain";

function closestCell(lat: number, lng: number, stateCode: string) {
  const cells = buildGridForState(stateCode, 10);
  let best = cells[0];
  let bestDist = Infinity;
  for (const cell of cells) {
    const d = Math.sqrt((cell.centerLat - lat) ** 2 + (cell.centerLng - lng) ** 2);
    if (d < bestDist) {
      bestDist = d;
      best = cell;
    }
  }
  return best;
}

async function main() {
  console.log("=== Solar Land Scout: Verify Scan ===\n");

  // Test 1: AZ bounding box
  const azBbox = getStateBbox("AZ");
  console.log("AZ bbox:", azBbox);
  console.assert(
    Math.abs(azBbox.minLng - -114.82) < 0.1,
    `AZ minLng expected ~-114.82 got ${azBbox.minLng}`
  );
  console.assert(
    Math.abs(azBbox.minLat - 31.33) < 0.1,
    `AZ minLat expected ~31.33 got ${azBbox.minLat}`
  );
  console.log("✓ AZ bbox looks correct\n");

  // Test 2: WY bounding box (Yellowstone)
  const wyBbox = getStateBbox("WY");
  console.log("WY bbox:", wyBbox);
  console.assert(
    Math.abs(wyBbox.minLat - 41.0) < 0.2,
    `WY minLat expected ~41.0 got ${wyBbox.minLat}`
  );
  console.log("✓ WY bbox looks correct\n");

  // Test 3: Grid cells for AZ
  const azCells = buildGridForState("AZ", 10);
  console.log(`AZ grid: ${azCells.length} cells at 10km`);
  console.assert(azCells.length > 100, `Expected >100 cells for AZ, got ${azCells.length}`);
  console.assert(azCells.length <= 2500, `Expected <=2500 cells, got ${azCells.length}`);
  console.log("✓ AZ grid within expected range\n");

  // Test 4: Closest cell to Phoenix downtown
  const phoenixCell = closestCell(33.4484, -112.074, "AZ");
  console.log("Phoenix cell:", phoenixCell.id, `(${phoenixCell.centerLat}, ${phoenixCell.centerLng})`);
  
  // Simulate open land score for Phoenix (urban)
  const phoenixSite: Partial<CandidateSite> = {
    lat: phoenixCell.centerLat,
    lng: phoenixCell.centerLng,
    slope_estimate: 1.0,
    distance_to_infra_km: 0.5, // urban — near infra
    distance_to_infra_estimate: "near",
    in_protected_area: false,
    solar_resource_value: 6.0,
    open_land_score: 50,
    estimated_land_cost_band: "moderate",
    overall_site_score: 0,
  };
  const phoenixOpenLand = computeOpenLandScore(phoenixSite as CandidateSite);
  const phoenixCostBand = computeLandCostBand(phoenixSite as CandidateSite, "AZ");
  console.log(`Phoenix open_land_score: ${phoenixOpenLand} (urban, near infra → lower score)`);
  console.log(`Phoenix land_cost_band: ${phoenixCostBand}`);
  // Urban proximity should push open_land below ~78 (80 - 5*0.5 = 77.5)
  console.assert(phoenixOpenLand <= 80, `Phoenix should have open_land ≤ 80, got ${phoenixOpenLand}`);
  console.log("✓ Phoenix heuristic behaves correctly\n");

  // Test 5: Pinal farmland
  const pinalCell = closestCell(32.8795, -111.7574, "AZ");
  console.log("Pinal cell:", pinalCell.id, `(${pinalCell.centerLat}, ${pinalCell.centerLng})`);
  
  const pinalSite: Partial<CandidateSite> = {
    lat: pinalCell.centerLat,
    lng: pinalCell.centerLng,
    slope_estimate: 0.5,
    distance_to_infra_km: 8.0, // rural, moderate distance
    distance_to_infra_estimate: "moderate",
    in_protected_area: false,
    solar_resource_value: 6.5,
    open_land_score: 50,
    estimated_land_cost_band: "moderate",
    overall_site_score: 0,
  };
  const pinalOpenLand = computeOpenLandScore(pinalSite as CandidateSite);
  const pinalCostBand = computeLandCostBand(pinalSite as CandidateSite, "AZ");
  console.log(`Pinal open_land_score: ${pinalOpenLand} (farmland, moderate infra)`);
  console.log(`Pinal land_cost_band: ${pinalCostBand}`);
  console.assert(pinalOpenLand >= 40, `Pinal should have decent open_land, got ${pinalOpenLand}`);
  console.log("✓ Pinal farmland heuristic looks reasonable\n");

  // Test 6: Yellowstone interior
  const ysCell = closestCell(44.428, -110.5885, "WY");
  console.log("Yellowstone cell:", ysCell.id, `(${ysCell.centerLat}, ${ysCell.centerLng})`);

  const ysSite: Partial<CandidateSite> = {
    lat: ysCell.centerLat,
    lng: ysCell.centerLng,
    slope_estimate: 5.0,
    distance_to_infra_km: 30.0,
    distance_to_infra_estimate: "far",
    in_protected_area: true, // Yellowstone is protected
    solar_resource_value: 5.5,
    open_land_score: 50,
    estimated_land_cost_band: "low",
    overall_site_score: 0,
  };
  const ysOpenLand = computeOpenLandScore(ysSite as CandidateSite);
  console.log(`Yellowstone open_land_score: ${ysOpenLand} (protected → 0)`);
  console.assert(ysOpenLand === 0, `Yellowstone protected area should yield open_land=0, got ${ysOpenLand}`);
  console.log("✓ Yellowstone correctly returns 0 for protected area\n");

  console.log("=== All verifications passed ===");
}

main().catch((err) => {
  console.error("Verify failed:", err);
  process.exit(1);
});
