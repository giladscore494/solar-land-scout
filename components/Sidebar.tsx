"use client";

import { useMemo } from "react";
import type { AnalysisRun, CandidateSite, Language, LandCostBand, SiteFilters, StateMacro } from "@/types/domain";
import { colorForScore } from "@/lib/color-ramp";
import { localizeInfra, localizeLandCostBand, localizeRecommendedLabel, localizeStateName, t } from "@/lib/i18n";
import StateDetail from "./StateDetail";
import SiteDetail from "./SiteDetail";

interface Props {
  language: Language;
  states: StateMacro[];
  statesLoading: boolean;
  statesError: string | null;
  sites: CandidateSite[];
  sitesLoading: boolean;
  sitesError: string | null;
  filters: SiteFilters;
  setFilters: (updater: (prev: SiteFilters) => SiteFilters) => void;
  selectedState: StateMacro | null;
  selectedSite: CandidateSite | null;
  latestRun: AnalysisRun | null;
  analysisRunning: boolean;
  analysisError: string | null;
  dbAvailable: boolean;
  onSelectState: (code: string | null) => void;
  onSelectSite: (id: string | null) => void;
  onClearState: () => void;
  onRunAnalysis: () => void;
}

export default function Sidebar({
  language,
  states,
  statesLoading,
  statesError,
  sites,
  sitesLoading,
  sitesError,
  filters,
  setFilters,
  selectedState,
  selectedSite,
  latestRun,
  analysisRunning,
  analysisError,
  dbAvailable,
  onSelectState,
  onSelectSite,
  onClearState,
  onRunAnalysis,
}: Props) {
  const topStates = useMemo(
    () => [...states].sort((a, b) => b.macro_total_score - a.macro_total_score).slice(0, 8),
    [states]
  );

  const visibleSites = useMemo(() => {
    if (typeof filters.min_macro_score === "number" && selectedState) {
      if (selectedState.macro_total_score < filters.min_macro_score) return [];
    }
    return sites;
  }, [filters.min_macro_score, selectedState, sites]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 pb-4 pt-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
            {selectedState ? t(language, "sidebar.intelligence") : t(language, "sidebar.overview")}
          </h2>
          {selectedState && (
            <button onClick={onClearState} className="text-[11px] font-medium text-ink-300 transition hover:text-ink-50">
              {t(language, "sidebar.back")}
            </button>
          )}
        </div>
        <div className="mt-1 text-[13px] text-ink-300">
          {selectedState ? t(language, "sidebar.detailCopy") : t(language, "sidebar.overviewCopy")}
        </div>
      </div>

      <div className="scroll-panel flex-1 overflow-y-auto px-5 py-5">
        <Filters
          language={language}
          filters={filters}
          setFilters={setFilters}
          states={states}
          onSelectState={onSelectState}
        />

        <div className="my-5 h-px bg-line" />

        {!selectedState ? (
          <div>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">{t(language, "states.top")}</h3>
            {statesLoading && <Skeleton rows={6} />}
            {statesError && <ErrorLine msg={t(language, "states.loadError")} detail={statesError} />}
            {!statesLoading && !statesError && states.length === 0 && <EmptyLine msg={t(language, "states.none")} />}
            <ul className="space-y-2">
              {topStates.map((state) => (
                <StateRow
                  key={state.state_code}
                  state={state}
                  language={language}
                  onClick={() => onSelectState(state.state_code)}
                />
              ))}
            </ul>

            <div className="mt-6 rounded-lg border border-line bg-bg-800/60 p-4 text-[12.5px] leading-relaxed text-ink-300">
              <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-ink-400">{t(language, "methodology.title")}</div>
              <p>{t(language, "methodology.body")}</p>
            </div>
          </div>
        ) : selectedSite ? (
          <SiteDetail site={selectedSite} language={language} onBack={() => onSelectSite(null)} />
        ) : (
          <>
            <StateDetail
              state={selectedState}
              language={language}
              latestRun={latestRun}
              analysisRunning={analysisRunning}
              analysisError={analysisError}
              dbAvailable={dbAvailable}
              onRunAnalysis={onRunAnalysis}
            />
            <div className="mt-6">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">{t(language, "sites.title")}</h3>
                <span className="font-mono text-[11px] text-ink-400">
                  {sitesLoading ? "…" : t(language, "sites.shown", { count: visibleSites.length })}
                </span>
              </div>
              {sitesLoading && <Skeleton rows={3} />}
              {sitesError && <ErrorLine msg={t(language, "sites.loadError")} detail={sitesError} />}
              {!sitesLoading && !sitesError && visibleSites.length === 0 && (
                <EmptyLine
                  msg={
                    analysisRunning
                      ? t(language, "state.running")
                      : latestRun?.status === "completed" && latestRun.site_count === 0
                        ? t(language, "state.analysisEmpty")
                        : latestRun
                          ? filters.strict_only === false
                            ? t(language, "sites.noneLoose")
                            : t(language, "sites.noneStrict")
                          : t(language, "empty.analysis")
                  }
                />
              )}
              {!dbAvailable && <div className="mb-3 text-[11px] text-ink-400">{t(language, "state.analysisUnavailable")}</div>}
              <ul className="space-y-2">
                {visibleSites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    language={language}
                    onClick={() => onSelectSite(site.id)}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-line px-5 py-3 text-[11px] text-ink-400">{t(language, "footer")}</div>
    </div>
  );
}

function Filters({
  language,
  filters,
  setFilters,
  states,
  onSelectState,
}: {
  language: Language;
  filters: SiteFilters;
  setFilters: Props["setFilters"];
  states: StateMacro[];
  onSelectState: (code: string | null) => void;
}) {
  const sortedStates = useMemo(
    () => [...states].sort((a, b) => localizeStateName(a, language).localeCompare(localizeStateName(b, language))),
    [language, states]
  );

  return (
    <div className="space-y-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">{t(language, "filters.title")}</h3>

      <FieldRow label={t(language, "filters.state")}>
        <select
          value={filters.state_code ?? ""}
          onChange={(event) => onSelectState(event.target.value || null)}
          className="w-full rounded-md border border-line bg-bg-700 px-2.5 py-1.5 text-[13px] text-ink-50 outline-none transition focus:border-accent-solar/60"
        >
          <option value="">{t(language, "filters.allStates")}</option>
          {sortedStates.map((state) => (
            <option key={state.state_code} value={state.state_code}>
              {localizeStateName(state, language)}
            </option>
          ))}
        </select>
      </FieldRow>

      <Slider
        label={t(language, "filters.minMacro")}
        min={0}
        max={100}
        step={1}
        value={filters.min_macro_score ?? 0}
        onChange={(value) => setFilters((current) => ({ ...current, min_macro_score: value === 0 ? undefined : value }))}
        suffix="/100"
      />
      <Slider
        label={t(language, "filters.minSolar")}
        min={3.5}
        max={7}
        step={0.1}
        value={filters.min_solar ?? 5}
        onChange={(value) => setFilters((current) => ({ ...current, min_solar: Number(value.toFixed(1)) }))}
      />
      <Slider
        label={t(language, "filters.maxSlope")}
        min={0}
        max={15}
        step={0.5}
        value={filters.max_slope ?? 5}
        onChange={(value) => setFilters((current) => ({ ...current, max_slope: value }))}
      />

      <FieldRow label={t(language, "filters.maxLandCost")}>
        <select
          value={filters.max_land_cost_band ?? "moderate"}
          onChange={(event) =>
            setFilters((current) => ({ ...current, max_land_cost_band: event.target.value as LandCostBand }))
          }
          className="w-full rounded-md border border-line bg-bg-700 px-2.5 py-1.5 text-[13px] text-ink-50 outline-none transition focus:border-accent-solar/60"
        >
          <option value="low">{t(language, "bands.low")}</option>
          <option value="moderate">{t(language, "bands.moderate")}</option>
          <option value="elevated">{t(language, "bands.elevated")}</option>
          <option value="high">{t(language, "bands.high")}</option>
        </select>
      </FieldRow>

      <label className="flex cursor-pointer items-center justify-between rounded-md border border-line bg-bg-800/60 px-3 py-2 text-[12.5px]">
        <span>
          <span className="font-medium text-ink-50">{t(language, "filters.strictOnly")}</span>
          <span className="ml-2 text-ink-400">{t(language, "filters.strictHint")}</span>
        </span>
        <input
          type="checkbox"
          checked={filters.strict_only !== false}
          onChange={(event) => setFilters((current) => ({ ...current, strict_only: event.target.checked }))}
          className="h-4 w-4 accent-accent-solar"
        />
      </label>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-ink-400">{label}</div>
      {children}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] text-ink-400">{label}</span>
        <span className="font-mono text-[11px] text-ink-100">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent-solar"
      />
    </div>
  );
}

function StateRow({ state, language, onClick }: { state: StateMacro; language: Language; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="group flex w-full items-center gap-3 rounded-md border border-line bg-bg-800/50 px-3 py-2.5 text-left transition hover:border-ink-400/40 hover:bg-bg-700"
      >
        <span
          className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-white/10"
          style={{ backgroundColor: colorForScore(state.macro_total_score) }}
        />
        <span className="flex-1 text-[13px] font-medium text-ink-50">{localizeStateName(state, language)}</span>
        <span className="font-mono text-[12px] text-ink-300">{state.macro_total_score.toFixed(1)}</span>
        <span className="text-[10px] uppercase tracking-wider text-ink-400 group-hover:text-ink-300">
          {tierPrefix(state, language)}
        </span>
      </button>
    </li>
  );
}

function tierPrefix(state: StateMacro, language: Language) {
  const label = localizeRecommendedLabel(state.recommended_label, language);
  const separatorIndex = label.indexOf(" — ");
  return separatorIndex >= 0 ? label.slice(0, separatorIndex) : label;
}

function SiteRow({ site, language, onClick }: { site: CandidateSite; language: Language; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="group w-full rounded-md border border-line bg-bg-800/50 px-3 py-2.5 text-left transition hover:border-accent-solar/40 hover:bg-bg-700"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink-50">{site.title}</div>
            <div className="mt-0.5 text-[11px] text-ink-400">
              GHI {site.solar_resource_value.toFixed(1)} · {t(language, "site.slope")} {site.slope_estimate.toFixed(1)}% · {localizeLandCostBand(site.estimated_land_cost_band, language)} · {t(language, "site.infra")} {localizeInfra(site.distance_to_infra_estimate, language)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[13px] text-accent-solar">{site.overall_site_score.toFixed(0)}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">{t(language, "site.score")}</div>
          </div>
        </div>
      </button>
    </li>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-md border border-line bg-bg-800/50" />
      ))}
    </div>
  );
}

function ErrorLine({ msg, detail }: { msg: string; detail: string }) {
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
      <div className="font-medium">{msg}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-red-300/80">{detail}</div>
    </div>
  );
}

function EmptyLine({ msg }: { msg: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-800/40 px-3 py-4 text-center text-[12px] text-ink-400">
      {msg}
    </div>
  );
}
