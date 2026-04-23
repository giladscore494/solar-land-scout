export interface ParcelMetrics {
  total_acres: number;
  usable_acres: number;
  contiguous_usable_acres: number;
  shape_regularity: number;
  mean_slope_percent: number;
  slope_stddev_percent: number;
  in_protected_area: boolean;
  protected_area_name: string | null;
  in_flood_zone: boolean;
  flood_zone_code: string | null;
  wetlands_pct: number;
  distance_to_transmission_km: number | null;
  nearest_transmission_kv: number | null;
  distance_to_substation_km: number | null;
  distance_to_road_km: number | null;
  ghi_kwh_m2_day: number | null;
}

export interface ScoredParcel {
  overall_score: number;
  passes_strict_filters: boolean;
  rejection_reason: string | null;
}

export function scoreParcel(metrics: ParcelMetrics): ScoredParcel {
  // Strict filter checks — any single REJECT means passes_strict_filters = false
  if (metrics.contiguous_usable_acres < 50) {
    return {
      overall_score: 0,
      passes_strict_filters: false,
      rejection_reason: "contiguous_usable_acres_lt_50",
    };
  }
  if (metrics.mean_slope_percent > 5) {
    return {
      overall_score: 0,
      passes_strict_filters: false,
      rejection_reason: "slope_gt_5pct",
    };
  }
  if (metrics.in_protected_area) {
    return {
      overall_score: 0,
      passes_strict_filters: false,
      rejection_reason: "in_protected_area",
    };
  }
  if (metrics.in_flood_zone) {
    return {
      overall_score: 0,
      passes_strict_filters: false,
      rejection_reason: "in_sfha_flood_zone",
    };
  }
  if (metrics.distance_to_transmission_km !== null && metrics.distance_to_transmission_km > 20) {
    return {
      overall_score: 0,
      passes_strict_filters: false,
      rejection_reason: "transmission_gt_20km",
    };
  }
  if (metrics.ghi_kwh_m2_day !== null && metrics.ghi_kwh_m2_day < 5.0) {
    return {
      overall_score: 0,
      passes_strict_filters: false,
      rejection_reason: "low_ghi",
    };
  }

  // Scoring (0-100) for parcels that pass strict filters
  let score = 0;

  // GHI (30 points): 5.0 = 0pts, 6.5+ = 30pts
  const ghi = metrics.ghi_kwh_m2_day ?? 5.0;
  const ghiScore = Math.min(30, Math.max(0, ((ghi - 5.0) / 1.5) * 30));
  score += ghiScore;

  // Acreage (25 points): 50 = 5pts, 500+ = 25pts
  const acreScore = Math.min(25, Math.max(5, ((metrics.contiguous_usable_acres - 50) / 450) * 20 + 5));
  score += acreScore;

  // Transmission proximity (20 points): 0km = 20pts, 20km = 0pts
  const transDist = metrics.distance_to_transmission_km ?? 20;
  const transScore = Math.max(0, (1 - transDist / 20) * 20);
  score += transScore;

  // Slope (15 points): 0% = 15pts, 5% = 0pts
  const slopeScore = Math.max(0, (1 - metrics.mean_slope_percent / 5) * 15);
  score += slopeScore;

  // Shape regularity (10 points)
  const shapeScore = metrics.shape_regularity * 10;
  score += shapeScore;

  return {
    overall_score: Math.round(Math.min(100, Math.max(0, score)) * 10) / 10,
    passes_strict_filters: true,
    rejection_reason: null,
  };
}
