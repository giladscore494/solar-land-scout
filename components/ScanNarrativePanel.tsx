"use client";

import type { ScanState } from "./ScanController";

interface Props {
  scanState: ScanState;
  onCancel: () => void;
}

const MISSING_COLUMNS_PREVIEW_LIMIT = 220;

export default function ScanNarrativePanel({ scanState, onCancel }: Props) {
  const {
    status,
    engine,
    requestedEngine,
    fallbackReason,
    dbHealth,
    hotzoneProgress,
    progress,
    tally,
    insights,
    activityLine,
    currentStage,
    elapsedMs,
    lastServerEventAt,
    errorMessage,
    cancelled,
    debugLog,
    gridSummary,
    recentRejectedCells,
  } = scanState;

  if (status === "idle") return null;

  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const tallyEntries = Object.entries(tally.rejected_by)
    .filter(([k]) => k !== "passed")
    .sort((a, b) => b[1] - a[1]);
  const missingParcelState = extractMissingParcelState(dbHealth?.warnings);

  return (
    <div className="mt-4 rounded-lg border border-line bg-bg-800/60 p-3 text-[12px]">
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="font-medium text-ink-200">
            {status === "scanning"
              ? "Scanning…"
              : status === "done"
              ? "Complete"
              : status === "cancelled"
              ? "Cancelled"
              : cancelled
              ? "Cancelled"
              : "Error"}
          </span>
          <span className="text-ink-400">
            {progress.processed}/{progress.total} ({pct}%)
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-700">
          <div
            className="h-full rounded-full bg-accent-solar transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between text-[10.5px] uppercase tracking-[0.16em] text-ink-400">
        <span>{engine ? `${engine} engine` : "scan"}</span>
        {currentStage && <span>{currentStage.replaceAll("_", " ")}</span>}
      </div>

      {(requestedEngine || fallbackReason) && (
        <div className="mb-2 grid grid-cols-2 gap-2 text-[11px] text-ink-300">
          <div>
            <span className="text-ink-500">requested:</span> {requestedEngine ?? "auto"}
          </div>
          <div>
            <span className="text-ink-500">selected:</span> {engine ?? "pending"}
          </div>
          {fallbackReason && (
            <div className="col-span-2 rounded-md bg-amber-500/10 px-2 py-1 text-amber-200">
              fallback: {fallbackReason}
            </div>
          )}
        </div>
      )}

      {(status === "scanning" || status === "done") && activityLine && (
        <div className="mb-2 flex items-start gap-1.5 text-[11px] text-ink-300">
          <span className="mt-px shrink-0 text-accent-solar" aria-hidden="true">⟳</span>
          <span className="font-mono">{activityLine}</span>
        </div>
      )}

      <details className="mb-3 rounded-md border border-line bg-bg-900/35 px-2 py-1.5">
        <summary className="cursor-pointer text-[10.5px] uppercase tracking-[0.16em] text-ink-400">
          Scan diagnostics
        </summary>
        <div className="mt-2 space-y-2 text-[11px] text-ink-300">
          <div className="grid grid-cols-2 gap-2">
            <div>stage: <span className="font-mono">{currentStage ?? "n/a"}</span></div>
            <div>elapsed: <span className="font-mono">{Math.round(elapsedMs / 100) / 10}s</span></div>
            <div>processed: <span className="font-mono">{progress.processed}</span></div>
            <div>total: <span className="font-mono">{progress.total}</span></div>
            <div className="col-span-2">
              last event: <span className="font-mono">{lastServerEventAt ?? "n/a"}</span>
            </div>
          </div>

          <div className="rounded-md border border-line/70 px-2 py-1.5">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-ink-500">db</div>
            <div className="grid grid-cols-2 gap-2">
              <div>connected: <span className="font-mono">{toYesNo(dbHealth?.database_connected)}</span></div>
              <div>postgis: <span className="font-mono">{toYesNo(dbHealth?.postgis_available)}</span></div>
              <div>legacy parcels: <span className="font-mono">{dbHealth?.legacy_parcels_for_state ?? "n/a"}</span></div>
              <div>raw imported features: <span className="font-mono">{dbHealth?.raw_features_for_state ?? "n/a"}</span></div>
              <div>unified parcels: <span className="font-mono">{dbHealth?.unified_parcels_for_state ?? "n/a"}</span></div>
              <div>scanner parcels: <span className="font-mono">{dbHealth?.scanner_parcels_for_state ?? "n/a"}</span></div>
              <div>effective parcels: <span className="font-mono">{dbHealth?.effective_parcels_for_state ?? "n/a"}</span></div>
              <div>scanner relation: <span className="font-mono">{dbHealth?.scanner_relation ?? "n/a"}</span></div>
              <div>parcel engine usable: <span className="font-mono">{toYesNo(dbHealth?.parcel_engine_usable)}</span></div>
              <div>url env: <span className="font-mono">{dbHealth?.selected_url_env ?? "n/a"}</span></div>
            </div>
            <div className="mt-1 space-y-1 font-mono text-[10.5px] text-ink-400">
              <div>fallback reason: {dbHealth?.reason ?? "OK"}</div>
              <div>missing tables: {joinList(dbHealth?.missing_tables)}</div>
              <div>missing indexes: {joinList(dbHealth?.missing_indexes)}</div>
              <div>blocking missing columns: {formatMissingColumns(dbHealth?.blocking_missing_columns)}</div>
              <div>optional missing columns: {formatMissingColumns(dbHealth?.optional_missing_columns)}</div>
            </div>
            {dbHealth?.next_action_message && (
              <div className="mt-2 rounded-md bg-sky-500/10 px-2 py-1.5 text-sky-200">
                next action: {dbHealth.next_action_message}
              </div>
            )}
            {dbHealth?.reason === "PARCEL_STATE_EMPTY" && (
              <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-200">
                Parcel engine unavailable because no parcel rows exist for {missingParcelState ?? "the requested state"}. Schema is mostly ready, but real parcel data must be imported before parcel scan can run.
              </div>
            )}
            {dbHealth?.parcel_coverage && (
              <div className="mt-2 rounded-md border border-line/70 px-2 py-1.5">
                <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-ink-500">parcel coverage</div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px]">
                  <div>raw: {dbHealth.parcel_coverage.raw_features_count}</div>
                  <div>unified: {dbHealth.parcel_coverage.unified_parcels_count}</div>
                  <div>true parcels: {dbHealth.parcel_coverage.true_parcels_count}</div>
                  <div>plss fallback: {dbHealth.parcel_coverage.plss_count}</div>
                  <div>dup links: {dbHealth.parcel_coverage.duplicate_links_count}</div>
                  <div>conflicts: {dbHealth.parcel_coverage.conflicts_count}</div>
                </div>
                <div className="mt-1 text-[10.5px] text-ink-400">
                  engine mode: <span className="font-mono">{dbHealth.parcel_coverage.engine_mode}</span> · relation{" "}
                  <span className="font-mono">{dbHealth.parcel_coverage.scanner_relation}</span>
                </div>
                <div className="mt-1 text-[10.5px] text-ink-400">
                  sources: {Object.entries(dbHealth.parcel_coverage.sources).map(([key, count]) => `${key}:${count}`).join(", ") || "none"}
                </div>
                {dbHealth.parcel_coverage.engine_mode === "parcel_like_fallback" && (
                  <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-200">
                    Using PLSS parcel-like cadastral sections, not assessor parcel boundaries.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border border-line/70 px-2 py-1.5">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-ink-500">hot zones</div>
            <div className="grid grid-cols-2 gap-2 font-mono">
              <div>planned: {hotzoneProgress?.planned ?? 0}</div>
              <div>scanned: {hotzoneProgress?.scanned ?? 0}</div>
              <div>ghi: {hotzoneProgress?.current_ghi ?? "n/a"}</div>
              <div>elapsed: {hotzoneProgress ? `${Math.round(hotzoneProgress.elapsed_ms / 100) / 10}s` : "n/a"}</div>
              {hotzoneProgress?.current_lat != null && hotzoneProgress?.current_lng != null && (
                <div className="col-span-2">
                  lat/lng: {hotzoneProgress.current_lat.toFixed(3)}, {hotzoneProgress.current_lng.toFixed(3)}
                </div>
              )}
              {hotzoneProgress?.current_bbox && (
                <div className="col-span-2">
                  bbox: {hotzoneProgress.current_bbox.map((value) => value.toFixed(2)).join(", ")}
                </div>
              )}
            </div>
          </div>

          {gridSummary && (
            <div className="rounded-md border border-line/70 px-2 py-1.5">
              <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-ink-500">grid calibration</div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px]">
                <div>strict passed: {gridSummary.strict_passed_sites}</div>
                <div>borderline: {gridSummary.borderline_candidates_count}</div>
                <div>data unknown: {gridSummary.data_unknown_candidates_count}</div>
                <div>cells: {gridSummary.processed_cells}/{gridSummary.total_cells}</div>
                <div>hard rejects: {Object.values(gridSummary.hard_reject_counts).reduce((sum, value) => sum + value, 0)}</div>
              </div>
              <div className="mt-2 space-y-1 text-[10.5px] text-ink-400">
                <div>slope distribution: {formatDistribution(gridSummary.metric_distribution.mean_slope_percent)}</div>
                <div>open land distribution: {formatDistribution(gridSummary.metric_distribution.open_land_pct)}</div>
                <div>ghi distribution: {formatDistribution(gridSummary.metric_distribution.ghi_kwh_m2_day)}</div>
                <div>transmission distance: {formatDistribution(gridSummary.metric_distribution.distance_to_transmission_km)}</div>
                <div>protected area pct: {formatDistribution(gridSummary.metric_distribution.protected_area_pct)}</div>
                <div>final score: {formatDistribution(gridSummary.metric_distribution.final_score)}</div>
              </div>
              {gridSummary.warnings.length > 0 && (
                <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-200">
                  {gridSummary.warnings.join(" · ")}
                </div>
              )}
              {gridSummary.strict_passed_sites === 0 && gridSummary.top_20_borderline_candidates.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500">top borderline candidates</div>
                  {gridSummary.top_20_borderline_candidates.slice(0, 5).map((candidate) => (
                    <div key={candidate.cell_id} className="rounded bg-bg-900/50 px-2 py-1 font-mono text-[10.5px] text-ink-300">
                      {candidate.cell_id} · score {candidate.score.toFixed(1)} · {candidate.reason} ·{" "}
                      {formatCandidateMetrics(candidate.metrics)}
                    </div>
                  ))}
                </div>
              )}
              {gridSummary.strict_passed_sites === 0 &&
                gridSummary.top_20_borderline_candidates.length === 0 &&
                gridSummary.top_20_data_unknown_candidates.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500">top data-unknown candidates</div>
                    {gridSummary.top_20_data_unknown_candidates.slice(0, 5).map((candidate) => (
                      <div key={candidate.cell_id} className="rounded bg-bg-900/50 px-2 py-1 font-mono text-[10.5px] text-ink-300">
                        {candidate.cell_id} · score {candidate.score.toFixed(1)} · {candidate.reason} ·{" "}
                        {formatCandidateMetrics(candidate.metrics)}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}

          {recentRejectedCells.length > 0 && (
            <div className="rounded-md border border-line/70 px-2 py-1.5">
              <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-ink-500">last 20 rejected cells</div>
              <div className="space-y-1 font-mono text-[10.5px] text-ink-300">
                {recentRejectedCells.map((entry) => (
                  <div key={`${entry.cellId}-${entry.reason}-${entry.diagnostics.score}`} className="rounded bg-bg-900/50 px-2 py-1">
                    {entry.cellId} {entry.verdict} {entry.reason} score={entry.diagnostics.score.toFixed(1)} actual=
                    {formatActualMetric(entry.reason, entry.diagnostics)} threshold=
                    {formatThreshold(entry.reason, entry.diagnostics)} slope=
                    {fmt(entry.diagnostics.metrics.mean_slope_percent)} open_land=
                    {fmt(entry.diagnostics.metrics.open_land_pct)} ghi={fmt(entry.diagnostics.metrics.ghi_kwh_m2_day)}{" "}
                    dist_km={fmt(entry.diagnostics.metrics.distance_to_transmission_km)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dbHealth?.warnings && dbHealth.warnings.length > 0 && (
            <div className="rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-200">
              {dbHealth.warnings.join(" · ")}
            </div>
          )}
        </div>
      </details>

      <div className="mb-2 text-[11.5px] text-ink-300">
        <span className="font-semibold text-emerald-400">{tally.passed}</span> sites passed
      </div>

      {tallyEntries.length > 0 && (
        <div className="mb-3 space-y-1">
          {tallyEntries.map(([key, count]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[10.5px] text-ink-400">{key}</span>
              <div className="flex-1">
                <div
                  className="h-1 rounded-full bg-red-500/50"
                  style={{
                    width: `${progress.total > 0 ? Math.round((count / progress.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <span className="shrink-0 font-mono text-[10.5px] text-ink-400">{count}</span>
            </div>
          ))}
        </div>
      )}

      {insights.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {insights.map((text, i) => (
            <div key={i} className="flex gap-1.5 text-[11px] text-ink-300">
              <span className="shrink-0 text-accent-solar">✦</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}

      {debugLog.length > 0 && (
        <div className="mb-3 rounded-md border border-line bg-bg-900/40 px-2 py-1.5">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-ink-500">recent events</div>
          <div className="space-y-1">
            {debugLog.slice(0, 10).map((line, i) => (
              <div key={i} className="font-mono text-[10.5px] text-ink-400">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {(status === "error" || status === "cancelled") && (
        <div className="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
          {cancelled || status === "cancelled" ? (
            <span>Scan cancelled by user.</span>
          ) : (
            <span>
              {currentStage && <span className="mr-1 font-semibold">Stage: {currentStage}.</span>}
              {errorMessage}
            </span>
          )}
        </div>
      )}

      {status === "scanning" && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 rounded-md border border-line bg-bg-700/60 px-3 py-1.5 text-[11px] text-ink-300 active:scale-[0.97]"
        >
          Cancel scan
        </button>
      )}
    </div>
  );
}

function joinList(values?: string[]): string {
  return values && values.length > 0 ? values.join(", ") : "none";
}

function toYesNo(value: boolean | undefined): string {
  if (value === undefined) return "n/a";
  return value ? "yes" : "no";
}

function formatMissingColumns(value?: Record<string, string[]>): string {
  if (!value || Object.keys(value).length === 0) return "none";
  const formatted = Object.entries(value)
    .map(([table, cols]) => `${table}[${cols.join(", ")}]`)
    .join("; ");
  return formatted.length > MISSING_COLUMNS_PREVIEW_LIMIT
    ? `${formatted.slice(0, MISSING_COLUMNS_PREVIEW_LIMIT - 3)}...`
    : formatted;
}

function formatDistribution(value: {
  min: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
  null_count: number;
}): string {
  return [value.min, value.p10, value.p25, value.median, value.p75, value.p90, value.max].every((item) => item === null)
    ? "n/a"
    : `min ${fmt(value.min)} · p10 ${fmt(value.p10)} · p25 ${fmt(value.p25)} · median ${fmt(value.median)} · p75 ${fmt(value.p75)} · p90 ${fmt(value.p90)} · max ${fmt(value.max)} · nulls ${value.null_count}`;
}

function formatActualMetric(
  reason: string,
  diagnostics: {
    metrics: { mean_slope_percent: number | null; open_land_pct: number | null; ghi_kwh_m2_day: number | null; protected_area_pct?: number | null };
  }
): string {
  if (reason === "high_slope") return fmt(diagnostics.metrics.mean_slope_percent);
  if (reason === "low_open_land") return fmt(diagnostics.metrics.open_land_pct);
  if (reason === "protected") return fmt(diagnostics.metrics.protected_area_pct ?? null);
  return fmt(diagnostics.metrics.ghi_kwh_m2_day);
}

function formatThreshold(
  reason: string,
  diagnostics: {
    thresholds: {
      max_hard_reject_slope_percent?: number;
      min_hard_reject_open_land_pct?: number;
      min_hard_reject_ghi_kwh_m2_day?: number;
      max_hard_reject_protected_area_pct?: number;
    };
  }
): string {
  if (reason === "high_slope") return fmt(diagnostics.thresholds.max_hard_reject_slope_percent ?? null);
  if (reason === "low_open_land") return fmt(diagnostics.thresholds.min_hard_reject_open_land_pct ?? null);
  if (reason === "protected") return fmt(diagnostics.thresholds.max_hard_reject_protected_area_pct ?? null);
  return fmt(diagnostics.thresholds.min_hard_reject_ghi_kwh_m2_day ?? null);
}

function formatCandidateMetrics(metrics: {
  mean_slope_percent: number | null;
  open_land_pct: number | null;
  ghi_kwh_m2_day: number | null;
}): string {
  return `slope ${fmt(metrics.mean_slope_percent)} · open ${fmt(metrics.open_land_pct)} · ghi ${fmt(
    metrics.ghi_kwh_m2_day
  )}`;
}

function fmt(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "n/a";
}

function extractMissingParcelState(warnings?: string[]): string | null {
  const match = warnings?.find((warning) => warning.startsWith("No parcels found for state "))?.match(/state\s+([A-Z]{2})$/);
  return match?.[1] ?? null;
}
