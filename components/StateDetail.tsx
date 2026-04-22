"use client";

import { useEffect, useState } from "react";
import type { AnalysisRun, ExplainResponse, Language, StateMacro } from "@/types/domain";
import { colorForScore } from "@/lib/color-ramp";
import { localizeRecommendedLabel, localizeStateName, t } from "@/lib/i18n";

interface Props {
  state: StateMacro;
  language: Language;
  latestRun: AnalysisRun | null;
  analysisRunning: boolean;
  analysisError: string | null;
  dbAvailable: boolean;
  onRunAnalysis: () => void;
}

export default function StateDetail({
  state,
  language,
  latestRun,
  analysisRunning,
  analysisError,
  dbAvailable,
  onRunAnalysis,
}: Props) {
  const { explain, loading, error, source } = useExplain("state", state.state_code, language);

  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          className="h-9 w-9 shrink-0 rounded-md ring-1 ring-white/10"
          style={{ backgroundColor: colorForScore(state.macro_total_score) }}
        />
        <div className="min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-400">{state.state_code}</div>
          <div className="truncate text-[18px] font-semibold">{localizeStateName(state, language)}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-mono text-[20px] font-semibold text-accent-solar">
            {state.macro_total_score.toFixed(1)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">{t(language, "state.macroScore")}</div>
        </div>
      </div>

      <div className="mt-2 text-[12px] text-ink-300">{localizeRecommendedLabel(state.recommended_label, language)}</div>

      <div className="mt-4 space-y-2">
        <Factor label={t(language, "factors.solar")} value={state.average_solar_potential_score} />
        <Factor label={t(language, "factors.land")} value={state.land_cost_score} />
        <Factor label={t(language, "factors.price")} value={state.electricity_price_score} />
        <Factor label={t(language, "factors.openLand")} value={state.open_land_availability_score} />
        <Factor label={t(language, "factors.dev")} value={state.development_friendliness_score} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <StatusCard title={t(language, "state.lastStatus")} value={latestRun ? t(language, `status.${latestRun.status}` as never) : "—"} />
        <StatusCard title={t(language, "state.generatedSites")} value={latestRun ? String(latestRun.site_count) : "—"} />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onRunAnalysis}
          disabled={analysisRunning || !dbAvailable}
          className="rounded-md border border-accent-solar/30 bg-accent-solar/10 px-4 py-2 text-[12.5px] font-medium text-accent-solar transition hover:border-accent-solar/50 hover:bg-accent-solar/15 disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-800 disabled:text-ink-400"
        >
          {analysisRunning ? t(language, "state.running") : t(language, "state.runAnalysis")}
        </button>
        {!dbAvailable && <span className="text-[11px] text-ink-400">{t(language, "state.analysisUnavailable")}</span>}
      </div>

      {latestRun?.notes && <div className="mt-3 rounded-md border border-line bg-bg-800/60 px-3 py-2 text-[12px] text-ink-300">{latestRun.notes}</div>}
      {analysisError && <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{analysisError}</div>}

      <div className="mt-5 rounded-lg border border-line bg-bg-800/60 p-4">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">{t(language, "state.why")}</div>
          <SourceBadge source={source} loading={loading} language={language} />
        </div>
        {loading && <p className="text-[12.5px] text-ink-300">{t(language, "site.generating")}</p>}
        {error && <p className="text-[12.5px] text-ink-300">{t(language, "state.geminiUnavailable")}</p>}
        {!loading && explain && (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-100">{explain.summary}</p>
            {explain.bullets.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {explain.bullets.map((bullet, index) => (
                  <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-300">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-solar" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            )}
            {explain.risks.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.18em] text-ink-400">{t(language, "state.verify")}</div>
                <ul className="space-y-1">
                  {explain.risks.map((risk, index) => (
                    <li key={index} className="flex gap-2 text-[12px] leading-relaxed text-ink-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
                      <span>{risk}</span>
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
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: colorForScore(value) }}
        />
      </div>
    </div>
  );
}

function StatusCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-800/60 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-400">{title}</div>
      <div className="mt-0.5 text-[13px] font-medium text-ink-50">{value}</div>
    </div>
  );
}

function SourceBadge({
  source,
  loading,
  language,
}: {
  source: "gemini" | "fallback" | null;
  loading: boolean;
  language: Language;
}) {
  if (loading) return <span className="text-[10px] text-ink-400">…</span>;
  if (source === "gemini") {
    return (
      <span className="rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 text-[10px] font-medium text-accent-cyan">
        {t(language, "source.gemini")}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-line bg-bg-700 px-2 py-0.5 text-[10px] font-medium text-ink-400">
      {t(language, "source.deterministic")}
    </span>
  );
}

export function useExplain(kind: "state" | "site", id: string, language: Language) {
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
          body: JSON.stringify({ kind, id, language }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as ExplainResponse;
        if (cancelled) return;
        setExplain(data);
        setSource(data.from_llm ? "gemini" : "fallback");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "explain_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, id, language]);

  return { explain, loading, error, source };
}
