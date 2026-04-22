"use client";

import { useEffect, useState } from "react";
import type { ExplainResponse, StateMacro } from "@/types/domain";
import { colorForScore } from "@/lib/color-ramp";

export default function StateDetail({ state }: { state: StateMacro }) {
  const { explain, loading, error, source } = useExplain("state", state.state_code);

  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          className="h-9 w-9 shrink-0 rounded-md ring-1 ring-white/10"
          style={{ backgroundColor: colorForScore(state.macro_total_score) }}
        />
        <div className="min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-400">
            {state.state_code}
          </div>
          <div className="truncate text-[18px] font-semibold">{state.state_name}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-mono text-[20px] font-semibold text-accent-solar">
            {state.macro_total_score.toFixed(1)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">macro score</div>
        </div>
      </div>

      <div className="mt-2 text-[12px] text-ink-300">{state.recommended_label}</div>

      {/* Factor bars */}
      <div className="mt-4 space-y-2">
        <Factor label="Solar potential" value={state.average_solar_potential_score} />
        <Factor label="Land cost" value={state.land_cost_score} />
        <Factor label="Electricity price" value={state.electricity_price_score} />
        <Factor label="Open-land availability" value={state.open_land_availability_score} />
        <Factor label="Development friendliness" value={state.development_friendliness_score} />
      </div>

      {/* Explanation */}
      <div className="mt-5 rounded-lg border border-line bg-bg-800/60 p-4">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">
            Why this state
          </div>
          <SourceBadge source={source} loading={loading} />
        </div>
        {loading && <p className="text-[12.5px] text-ink-300">Generating analyst summary…</p>}
        {error && (
          <p className="text-[12.5px] text-ink-300">
            Using fallback summary.{" "}
            <span className="text-ink-400">{state.macro_summary_seed}</span>
          </p>
        )}
        {!loading && !error && explain && (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-100">{explain.summary}</p>
            {explain.bullets.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {explain.bullets.map((b, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[12.5px] leading-relaxed text-ink-300"
                  >
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-solar" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
            {explain.risks.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.18em] text-ink-400">
                  Still to verify
                </div>
                <ul className="space-y-1">
                  {explain.risks.map((r, i) => (
                    <li
                      key={i}
                      className="flex gap-2 text-[12px] leading-relaxed text-ink-400"
                    >
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Factor({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11.5px] text-ink-300">
        <span>{label}</span>
        <span className="font-mono text-ink-100">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-700">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            backgroundColor: colorForScore(value),
          }}
        />
      </div>
    </div>
  );
}

function SourceBadge({
  source,
  loading,
}: {
  source: "gemini" | "fallback" | null;
  loading: boolean;
}) {
  if (loading)
    return <span className="text-[10px] text-ink-400">…</span>;
  if (source === "gemini")
    return (
      <span className="rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 text-[10px] font-medium text-accent-cyan">
        gemini
      </span>
    );
  return (
    <span className="rounded-full border border-line bg-bg-700 px-2 py-0.5 text-[10px] font-medium text-ink-400">
      deterministic
    </span>
  );
}

/** Shared hook used by both StateDetail and SiteDetail. */
export function useExplain(kind: "state" | "site", id: string) {
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"gemini" | "fallback" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExplain(null);
    setSource(null);
    (async () => {
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, id }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as ExplainResponse;
        if (cancelled) return;
        setExplain(data);
        setSource(data.from_llm ? "gemini" : "fallback");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "explain_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  return { explain, loading, error, source };
}
