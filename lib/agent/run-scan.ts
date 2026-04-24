import type { CandidateSite } from "@/types/domain";
import type { ScanEvent, ScanEngine } from "@/types/scan-events";
import type { ScanDbHealthSummary } from "@/types/db-health";
import type {
  GridCandidateExample,
  GridCellDiagnostics,
  GridRejectedExample,
  GridScanSummary,
} from "@/types/grid-scan";
import { buildGridForState } from "./grid";
import { prefilterCells } from "./prefilter";
import { runWorkerPool } from "./worker-pool";
import { processCell } from "./process-cell";
import { getStateBbox } from "./state-bbox";
import { createAnalysisRun, completeAnalysisRun, saveCandidateSites } from "@/lib/analysis-runs";
import { getPostgresPool } from "@/lib/postgres";
import { ensureSchema } from "@/lib/db-schema";

export interface ScanOptions {
  sizeKm?: number;
  maxCells?: number;
  signal?: AbortSignal;
  onEvent?: (e: ScanEvent) => void;
  requestedEngine?: ScanEngine;
  fallbackReason?: string | null;
  dbHealth?: ScanDbHealthSummary;
}

export interface ScanResult {
  runId: number | null;
  stateCode: string;
  passed: number;
  total: number;
  rejected_by: Record<string, number>;
  sites: CandidateSite[];
  scan_summary?: GridScanSummary;
}

const MAX_GEMINI_CALLS = 25;
const GEMINI_BATCH_SIZE = 10;
// Arizona currently scans as a 50x50 capped grid, so 2500 processed cells means
// the sanity check is evaluating the full planned coverage instead of a partial run.
const AZ_SANITY_CHECK_MIN_CELLS = 2500;

export async function runStateScan(
  stateCode: string,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  const { sizeKm = 10, signal, onEvent, requestedEngine, fallbackReason, dbHealth } = opts;
  const emit = onEvent ?? (() => undefined);
  const scanContext = {
    requestedEngine,
    fallbackReason,
    db_health: dbHealth,
  };

  const run = await createAnalysisRun(stateCode, "en");
  const bbox = getStateBbox(stateCode);
  const bboxArr: [number, number, number, number] = [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];

  let currentStage = "initializing";
  let currentActivity = `Starting grid scan for ${stateCode}`;
  let processed = 0;
  let total = 0;
  const scanStart = Date.now();

  const heartbeatTimer = setInterval(() => {
    if (signal?.aborted) return;
    emit({
      type: "scan_heartbeat",
      engine: "grid",
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
    currentStage = "building_grid";
    currentActivity = `Building ${sizeKm}km grid for ${stateCode}`;
    emit({
      type: "scan_started",
      engine: "grid",
      ...scanContext,
      stateCode,
      totalCells: 0,
      processed: 0,
      passed: 0,
      rejected: 0,
      currentStage,
      bbox: bboxArr,
      at: new Date().toISOString(),
    });

    const allCells = buildGridForState(stateCode, sizeKm);
    currentActivity = `Grid built: ${allCells.length} cells`;

    currentStage = "prefiltering";
    currentActivity = `Pre-filtering ${allCells.length} cells via NASA POWER`;
    let kept = allCells;
    try {
      const prefilterResult = await prefilterCells(allCells, signal);
      kept = prefilterResult.kept;
      currentActivity = `Pre-filter complete: ${kept.length}/${allCells.length} cells kept`;
    } catch (err) {
      console.warn("[runStateScan] prefilter failed, keeping all cells:", err);
      kept = allCells;
      currentActivity = `Pre-filter skipped (${err instanceof Error ? err.message : "error"}), scanning all ${allCells.length} cells`;
    }

    emit({
      type: "scan_started",
      engine: "grid",
      ...scanContext,
      stateCode,
      totalCells: kept.length,
      processed: 0,
      passed: 0,
      rejected: 0,
      currentStage,
      bbox: bboxArr,
      at: new Date().toISOString(),
    });

    const rejected_by: Record<string, number> = {};
    const hardRejectCounts: Record<string, number> = {};
    const passedSites: CandidateSite[] = [];
    const borderlineCandidates: GridCandidateExample[] = [];
    const rejectedExamples: GridRejectedExample[] = [];
    const metricSamples = {
      mean_slope_percent: [] as number[],
      open_land_pct: [] as number[],
      ghi_kwh_m2_day: [] as number[],
    };
    let geminiCallCount = 0;
    let lastGeminiTime = 0;
    total = kept.length;
    const recentResults: string[] = [];

    async function maybeEmitInsight(force = false): Promise<void> {
      const now = Date.now();
      const timeSinceLastGemini = now - lastGeminiTime;
      const shouldEmit =
        geminiCallCount < MAX_GEMINI_CALLS &&
        (force || recentResults.length >= GEMINI_BATCH_SIZE || timeSinceLastGemini >= 3000);

      if (!shouldEmit || recentResults.length === 0) return;

      geminiCallCount++;
      lastGeminiTime = now;
      const snapshot = recentResults.splice(0, GEMINI_BATCH_SIZE);
      const text = await narrateScanBatch(stateCode, snapshot, passedSites.length, total);
      emit({ type: "insight", text, cellsCovered: processed, at: new Date().toISOString() });
    }

    currentStage = "scanning_cells";
    currentActivity = `Scanning 0/${total} cells`;
    await runWorkerPool({
      tasks: kept,
      concurrency: 8,
      signal,
      process: (cell) => processCell(cell, signal),
      onResult: async (result) => {
        if (!result) return;
        processed++;

        const { site, rejectionReason, diagnostics } = result;
        const hardReject = isHardReject(site, diagnostics);
        const verdict =
          diagnostics.candidate_kind === "strict_pass"
            ? "passed"
            : hardReject
            ? "hard_reject"
            : "soft_reject";

        if (diagnostics.metrics.mean_slope_percent !== null) {
          metricSamples.mean_slope_percent.push(diagnostics.metrics.mean_slope_percent);
        }
        if (diagnostics.metrics.open_land_pct !== null) {
          metricSamples.open_land_pct.push(diagnostics.metrics.open_land_pct);
        }
        if (diagnostics.metrics.ghi_kwh_m2_day !== null) {
          metricSamples.ghi_kwh_m2_day.push(diagnostics.metrics.ghi_kwh_m2_day);
        }

        const key = rejectionReason === "passed" ? "passed" : rejectionReason;
        rejected_by[key] = (rejected_by[key] ?? 0) + 1;
        if (hardReject && rejectionReason !== "passed") {
          hardRejectCounts[rejectionReason] = (hardRejectCounts[rejectionReason] ?? 0) + 1;
        }

        currentActivity = `Scanning cell ${processed}/${total} — ${passedSites.length} strict passes so far`;

        emit({
          type: "cell_result",
          cellId: result.cell.id,
          bbox: result.cell.bboxDeg,
          verdict,
          rejectionReason,
          site: diagnostics.candidate_kind === "strict_pass" ? site : undefined,
          diagnostics,
        });

        if (diagnostics.candidate_kind === "strict_pass") {
          passedSites.push(site);
        } else if (diagnostics.borderline) {
          borderlineCandidates.push({
            cell_id: result.cell.id,
            score: diagnostics.score,
            reason: rejectionReason,
            metrics: diagnostics.metrics,
            thresholds: diagnostics.thresholds,
          });
        }

        if (diagnostics.candidate_kind !== "strict_pass") {
          rejectedExamples.push({
            cell_id: result.cell.id,
            score: diagnostics.score,
            rejection_reason: rejectionReason,
            metrics: diagnostics.metrics,
            thresholds: diagnostics.thresholds,
          });
        }

        recentResults.push(
          `${result.cell.id}: ${rejectionReason} (score=${diagnostics.score.toFixed(1)})`
        );

        if (processed % 10 === 0) {
          emit({
            type: "tally_update",
            engine: "grid",
            rejected_by: { ...rejected_by },
            passed: passedSites.length,
            rejected: processed - passedSites.length,
            processed,
            total,
          });
          currentStage = "generating_insights";
          currentActivity = `Generating insight after ${processed} cells`;
          await maybeEmitInsight();
          currentStage = "scanning_cells";
          currentActivity = `Scanning cell ${processed}/${total} — ${passedSites.length} strict passes so far`;
        }
      },
    });

    if (recentResults.length > 0) {
      currentStage = "generating_insights";
      currentActivity = "Generating final insight summary";
      await maybeEmitInsight(true);
    }

    currentStage = "persisting_results";
    currentActivity = `Saving ${passedSites.length} candidate sites to database`;
    if (run && passedSites.length > 0) {
      try {
        await saveCandidateSites(run.id, passedSites.map((s) => ({ ...s, run_id: run.id })));
      } catch {
        // non-fatal
      }
    }

    const summaryPayload = buildScanSummary({
      stateCode,
      total,
      processed,
      strictPassedSites: passedSites.length,
      hardRejectCounts,
      borderlineCandidates,
      rejectedExamples,
      metricSamples,
      rejectedBy: rejected_by,
    });
    const summary = buildSummaryLine(total, passedSites.length, rejected_by, summaryPayload);

    currentStage = "finalizing";
    currentActivity = "Finalizing analysis run record";
    if (run) {
      try {
        await completeAnalysisRunWithTally(run.id, "completed", summary, summaryPayload, rejected_by);
      } catch {
        // non-fatal
      }
    }

    emit({
      type: "tally_update",
      engine: "grid",
      rejected_by: { ...rejected_by },
      passed: passedSites.length,
      rejected: processed - passedSites.length,
      processed,
      total,
    });

    emit({
      type: "scan_completed",
      engine: "grid",
      ...scanContext,
      runId: run?.id ?? null,
      passed: passedSites.length,
      total,
      rejected_by: { ...rejected_by },
      scan_summary: summaryPayload,
      at: new Date().toISOString(),
    });

    return {
      runId: run?.id ?? null,
      stateCode,
      passed: passedSites.length,
      total,
      rejected_by,
      sites: passedSites,
      scan_summary: summaryPayload,
    };
  } catch (error) {
    const cancelled = signal?.aborted ?? false;
    const msg = cancelled ? "scan_cancelled" : error instanceof Error ? error.message : "scan_failed";
    if (run) {
      try {
        await completeAnalysisRun(run.id, cancelled ? "cancelled" : "failed", msg, null);
      } catch {
        // non-fatal
      }
    }
    emit({
      type: "scan_error",
      engine: "grid",
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

function isHardReject(site: CandidateSite, diagnostics: GridCellDiagnostics): boolean {
  return (
    site.in_protected_area === true ||
    site.in_flood_zone === true ||
    (diagnostics.metrics.mean_slope_percent !== null &&
      diagnostics.metrics.mean_slope_percent > (diagnostics.thresholds.max_hard_reject_slope_percent ?? Infinity)) ||
    (diagnostics.metrics.open_land_pct !== null &&
      diagnostics.metrics.open_land_pct < (diagnostics.thresholds.min_hard_reject_open_land_pct ?? -Infinity))
  );
}

function buildScanSummary(args: {
  stateCode: string;
  total: number;
  processed: number;
  strictPassedSites: number;
  hardRejectCounts: Record<string, number>;
  borderlineCandidates: GridCandidateExample[];
  rejectedExamples: GridRejectedExample[];
  metricSamples: {
    mean_slope_percent: number[];
    open_land_pct: number[];
    ghi_kwh_m2_day: number[];
  };
  rejectedBy: Record<string, number>;
}): GridScanSummary {
  const topBorderline = [...args.borderlineCandidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const worstRejected = [...args.rejectedExamples]
    .sort((a, b) => a.score - b.score)
    .slice(0, 20);
  const warnings: string[] = [];

  const onlySlopeOpenLandRejects =
    args.strictPassedSites === 0 &&
    (args.rejectedBy.high_slope ?? 0) + (args.rejectedBy.low_open_land ?? 0) === args.total;
  if (args.stateCode === "AZ" && args.processed >= AZ_SANITY_CHECK_MIN_CELLS && onlySlopeOpenLandRejects) {
    warnings.push(
      "AZ sanity warning: every grid cell was rejected only by slope/open-land. This likely indicates overly strict thresholds or a metric calculation issue. Inspect metric distributions."
    );
  }
  if (args.strictPassedSites === 0 && topBorderline.length > 0) {
    warnings.push(
      "No strict-pass sites found under current thresholds; showing best borderline candidates for calibration."
    );
  }

  return {
    state_code: args.stateCode,
    total_cells: args.total,
    processed_cells: args.processed,
    strict_passed_sites: args.strictPassedSites,
    borderline_candidates_count: args.borderlineCandidates.length,
    hard_reject_counts: args.hardRejectCounts,
    metric_distribution: {
      mean_slope_percent: summarizeDistribution(args.metricSamples.mean_slope_percent),
      open_land_pct: summarizeDistribution(args.metricSamples.open_land_pct),
      ghi_kwh_m2_day: summarizeDistribution(args.metricSamples.ghi_kwh_m2_day),
    },
    top_20_borderline_candidates: topBorderline,
    worst_20_rejected_examples: worstRejected,
    warnings,
  };
}

function summarizeDistribution(values: number[]) {
  if (values.length === 0) {
    return { min: null, p25: null, median: null, p75: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: round(sorted[0]),
    p25: round(percentile(sorted, 0.25)),
    median: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    max: round(sorted[sorted.length - 1]),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildSummaryLine(
  total: number,
  passed: number,
  rejectedBy: Record<string, number>,
  summary: GridScanSummary
): string {
  return `Grid scan: ${total} cells processed, ${passed} strict passes, ${summary.borderline_candidates_count} borderline candidates. Rejected: ${Object.entries(
    rejectedBy
  )
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")}`;
}

async function narrateScanBatch(
  stateCode: string,
  recentResults: string[],
  passedCount: number,
  totalCells: number
): Promise<string> {
  try {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) {
      return `Scanned ${recentResults.length} cells in ${stateCode}. ${passedCount} sites passed so far out of ${totalCells} total.`;
    }

    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: key });

    const prompt = `You are a solar feasibility analyst. In one concise sentence (max 120 chars), describe the scan progress for state ${stateCode}. Recent cell results: ${recentResults.slice(0, 5).join("; ")}. Passed: ${passedCount}/${totalCells}. Be specific about patterns you notice.`;

    const response = await Promise.race([
      client.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3-pro-preview",
        contents: prompt,
        config: { temperature: 0.4, maxOutputTokens: 150 },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    if (!response) return `Scanning ${stateCode}: ${passedCount} sites found so far.`;

    const text =
      typeof (response as { text?: unknown }).text === "string"
        ? (response as { text: string }).text
        : "";

    return text.trim().slice(0, 200) || `${stateCode}: ${passedCount} sites passed so far.`;
  } catch {
    return `Scanning ${stateCode}: ${passedCount} sites passed out of ${totalCells} cells.`;
  }
}

async function completeAnalysisRunWithTally(
  runId: number,
  status: string,
  notes: string,
  debugJson: unknown,
  rejectedBy: Record<string, number>
): Promise<void> {
  const pool = await getPostgresPool();
  if (!pool) return;
  await ensureSchema(pool);
  try {
    await pool.query(
      `UPDATE analysis_runs 
       SET status=$2, completed_at=NOW(), notes=$3, gemini_debug_json=$4, 
           gemini_debug_enabled=true, gemini_debug_version='v2',
           rejected_by_json=$5::jsonb
       WHERE id=$1`,
      [runId, status, notes, debugJson, JSON.stringify(rejectedBy)]
    );
  } catch {
    await pool.query(
      `UPDATE analysis_runs SET status=$2, completed_at=NOW(), notes=$3, gemini_debug_json=$4, gemini_debug_enabled=true, gemini_debug_version='v2' WHERE id=$1`,
      [runId, status, notes, debugJson]
    );
  }
}
