"use client";

import type { ScanState } from "./ScanController";

interface Props {
  scanState: ScanState;
  onCancel: () => void;
}

export default function ScanNarrativePanel({ scanState, onCancel }: Props) {
  const { status, progress, tally, insights, activityLine, currentStage, errorMessage, cancelled } = scanState;

  if (status === "idle") return null;

  const pct =
    progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

  const tallyEntries = Object.entries(tally.rejected_by)
    .filter(([k]) => k !== "passed")
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mt-4 rounded-lg border border-line bg-bg-800/60 p-3 text-[12px]">
      {/* Progress bar */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="font-medium text-ink-200">
            {status === "scanning"
              ? "Scanning…"
              : status === "done"
              ? "Complete"
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

      {/* Live activity line */}
      {(status === "scanning" || status === "done") && activityLine && (
        <div className="mb-2 flex items-start gap-1.5 text-[11px] text-ink-300">
          <span className="mt-px shrink-0 text-accent-solar" aria-hidden="true">⟳</span>
          <span className="font-mono">{activityLine}</span>
        </div>
      )}

      {/* Passed count */}
      <div className="mb-2 text-[11.5px] text-ink-300">
        <span className="font-semibold text-emerald-400">{tally.passed}</span> sites passed
      </div>

      {/* Tally grid */}
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

      {/* Insights */}
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

      {/* Error / cancellation detail */}
      {status === "error" && (
        <div className="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
          {cancelled ? (
            <span>Scan cancelled by user.</span>
          ) : (
            <span>
              {currentStage && (
                <span className="mr-1 font-semibold">Stage: {currentStage}.</span>
              )}
              {errorMessage}
            </span>
          )}
        </div>
      )}

      {/* Cancel button */}
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
