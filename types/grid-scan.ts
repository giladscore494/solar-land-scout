export interface GridCellMetrics {
  mean_slope_percent: number | null;
  open_land_pct: number | null;
  ghi_kwh_m2_day: number | null;
  distance_to_transmission_km: number | null;
  protected_area_pct: number | null;
  water_pct: number | null;
  urban_pct: number | null;
}

export interface GridCellThresholds {
  max_hard_reject_slope_percent?: number;
  min_hard_reject_open_land_pct?: number;
  min_hard_reject_ghi_kwh_m2_day?: number;
  max_hard_reject_protected_area_pct?: number;
  max_hard_reject_water_pct?: number;
  max_hard_reject_urban_pct?: number;
  strict_max_slope_percent?: number;
  strict_min_open_land_pct?: number;
  strict_min_ghi_kwh_m2_day?: number;
  strict_min_score?: number;
}

export type GridCandidateKind =
  | "strict_pass"
  | "borderline_candidate"
  | "data_unknown_candidate"
  | "hard_reject";

export interface GridCellDiagnostics {
  score: number;
  candidate_kind: GridCandidateKind;
  borderline: boolean;
  warnings: string[];
  metrics: GridCellMetrics;
  thresholds: GridCellThresholds;
}

export interface GridCandidateExample {
  cell_id: string;
  score: number;
  reason: string;
  metrics: GridCellMetrics;
  thresholds: GridCellThresholds;
}

export interface GridRejectedExample {
  cell_id: string;
  score: number;
  rejection_reason: string;
  metrics: GridCellMetrics;
  thresholds: GridCellThresholds;
}

export interface GridMetricDistribution {
  min: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
  null_count: number;
}

export interface GridScanSummary {
  state_code: string;
  total_cells: number;
  processed_cells: number;
  strict_passed_sites: number;
  borderline_candidates_count: number;
  data_unknown_candidates_count: number;
  hard_reject_counts: Record<string, number>;
  metric_distribution: {
    mean_slope_percent: GridMetricDistribution;
    open_land_pct: GridMetricDistribution;
    ghi_kwh_m2_day: GridMetricDistribution;
    distance_to_transmission_km: GridMetricDistribution;
    protected_area_pct: GridMetricDistribution;
    final_score: GridMetricDistribution;
  };
  top_20_borderline_candidates: GridCandidateExample[];
  top_20_data_unknown_candidates: GridCandidateExample[];
  worst_20_rejected_examples: GridRejectedExample[];
  warnings: string[];
}
