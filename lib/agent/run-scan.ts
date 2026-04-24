import type { CandidateSite } from "@/types/domain";
import type { ScanEvent, ScanEngine } from "@/types/scan-events";
import type { ScanDbHealthSummary } from "@/types/db-health";
import { buildGridForState } from "./grid";
import { prefilterCells } from "./prefilter";
import { runWorkerPool } from "./worker-pool";
import { processCell } from "./process-cell";
import type { RejectionReason } from "./process-cell";
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
}

const MAX_GEMINI_CALLS = 25;
const GEMINI_BATCH_SIZE = 10;

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

  // 1. Create analysis run
  const run = await createAnalysisRun(stateCode, "en");

  const bbox = getStateBbox(stateCode);
  const bboxArr: [number, number, number, number] = [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat];

  // Heartbeat state
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
    // 2. Build grid
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

    // 3. Prefilter
    currentStage = "prefiltering";
    currentActivity = `Pre-filtering ${allCells.length} cells via NASA POWER`;
    let kept = allCells;
    try {
      const prefilterResult = await prefilterCells(allCells, signal);
      kept = prefilterResult.kept;
      currentActivity = `Pre-filter complete: ${kept.length}/${allCells.length} cells kept`;
    } catch (err) {
      // NASA POWER is optional — if prefilter fails, proceed with all cells
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

    // 4. Track state
    const rejected_by: Record<string, number> = {};
    const passedSites: CandidateSite[] = [];
    let geminiCallCount = 0;
    let lastGeminiTime = 0;
    total = kept.length;

    // Insight accumulator
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

    // 5. Run worker pool
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

        const { site, rejectionReason } = result;

        // Tally rejection
        const key = rejectionReason === "passed" ? "passed" : rejectionReason;
        rejected_by[key] = (rejected_by[key] ?? 0) + 1;

        // Update heartbeat activity
        currentActivity = `Scanning cell ${processed}/${total} — ${passedSites.length} passed so far`;

        // Emit cell events
        emit({
          type: "cell_result",
          cellId: result.cell.id,
          bbox: result.cell.bboxDeg,
          verdict:
            rejectionReason === "passed"
              ? "passed"
              : isSoftReject(rejectionReason)
              ? "soft_reject"
              : "hard_reject",
          rejectionReason,
          site: rejectionReason === "passed" ? site : undefined,
        });

        if (rejectionReason === "passed") {
          passedSites.push(site);
        }

        recentResults.push(
          `${result.cell.id}: ${rejectionReason}${
            rejectionReason === "passed" ? ` (score=${site.overall_site_score})` : ""
          }`
        );

        // Emit tally every 10 cells
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
          currentActivity = `Scanning cell ${processed}/${total} — ${passedSites.length} passed so far`;
        }
      },
    });

    // Final insight
    if (recentResults.length > 0) {
      currentStage = "generating_insights";
      currentActivity = "Generating final insight summary";
      await maybeEmitInsight(true);
    }

    // 6. Persist passing sites
    currentStage = "persisting_results";
    currentActivity = `Saving ${passedSites.length} candidate sites to database`;
    if (run && passedSites.length > 0) {
      try {
        await saveCandidateSites(run.id, passedSites.map((s) => ({ ...s, run_id: run.id })));
      } catch {
        // non-fatal
      }
    }

    // 7. Finalize run
    currentStage = "finalizing";
    currentActivity = "Finalizing analysis run record";
    const summary = `Grid scan: ${total} cells processed, ${passedSites.length} passed. Rejected: ${Object.entries(rejected_by).map(([k, v]) => `${k}=${v}`).join(", ")}`;

    if (run) {
      try {
        await completeAnalysisRunWithTally(run.id, "completed", summary, null, rejected_by);
      } catch {
        // non-fatal
      }
    }

    // Final tally
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
    const msg = cancelled
      ? "scan_cancelled"
      : error instanceof Error
      ? error.message
      : "scan_failed";
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

function isSoftReject(reason: RejectionReason): boolean {
  return reason === "low_overall_score" || reason === "expensive_land" || reason === "far_infra";
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
    // Column may not exist yet — fall back to basic update
    await pool.query(
      `UPDATE analysis_runs SET status=$2, completed_at=NOW(), notes=$3, gemini_debug_json=$4, gemini_debug_enabled=true, gemini_debug_version='v2' WHERE id=$1`,
      [runId, status, notes, debugJson]
    );
  }
}
