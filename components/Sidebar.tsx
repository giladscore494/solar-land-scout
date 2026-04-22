"use client";

import { useMemo } from "react";
import type {
  CandidateSite,
  LandCostBand,
  SiteFilters,
  StateMacro,
} from "@/types/domain";
import StateDetail from "./StateDetail";
import SiteDetail from "./SiteDetail";
import { colorForScore } from "@/lib/color-ramp";

interface Props {
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
  onSelectState: (code: string | null) => void;
  onSelectSite: (id: string | null) => void;
  onClearState: () => void;
}

export default function Sidebar(props: Props) {
  const {
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
    onSelectState,
    onSelectSite,
    onClearState,
  } = props;

  const topStates = useMemo(
    () =>
      [...states]
        .sort((a, b) => b.macro_total_score - a.macro_total_score)
        .slice(0, 8),
    [states]
  );

  const visibleSites = useMemo(() => {
    if (typeof filters.min_macro_score === "number" && selectedState) {
      // Macro filter is state-level; just hide sites if state didn't qualify.
      if (selectedState.macro_total_score < filters.min_macro_score) return [];
    }
    return sites;
  }, [sites, filters.min_macro_score, selectedState]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line px-5 pb-4 pt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
            {selectedState ? "State intelligence" : "USA macro overview"}
          </h2>
          {selectedState && (
            <button
              onClick={onClearState}
              className="text-[11px] font-medium text-ink-300 transition hover:text-ink-50"
            >
              ← back to USA
            </button>
          )}
        </div>
        <div className="mt-1 text-[13px] text-ink-300">
          {selectedState
            ? "Filter candidate sites and drill into qualification detail."
            : "Rank of U.S. states by weighted solar-development attractiveness."}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="scroll-panel flex-1 overflow-y-auto px-5 py-5">
        {/* Filters */}
        <Filters
          filters={filters}
          setFilters={setFilters}
          states={states}
          onSelectState={onSelectState}
        />

        <div className="my-5 h-px bg-line" />

        {/* Main section depends on mode */}
        {!selectedState ? (
          <div>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
              Top states
            </h3>
            {statesLoading && <Skeleton rows={6} />}
            {statesError && (
              <ErrorLine msg="Could not load state rankings." detail={statesError} />
            )}
            {!statesLoading && !statesError && states.length === 0 && (
              <EmptyLine msg="No state data available." />
            )}
            <ul className="space-y-2">
              {topStates.map((s) => (
                <StateRow key={s.state_code} state={s} onClick={() => onSelectState(s.state_code)} />
              ))}
            </ul>

            <div className="mt-6 rounded-lg border border-line bg-bg-800/60 p-4 text-[12.5px] leading-relaxed text-ink-300">
              <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-ink-400">
                Methodology
              </div>
              <p>
                Macro score = weighted blend of solar resource, land cost,
                electricity price, open-land availability, and
                development-friendliness. Weights are config-driven; click a
                state to zoom in and see candidate sites that pass the strict v1
                filter set.
              </p>
            </div>
          </div>
        ) : selectedSite ? (
          <SiteDetail site={selectedSite} onBack={() => onSelectSite(null)} />
        ) : (
          <>
            <StateDetail state={selectedState} />
            <div className="mt-6">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
                  Candidate sites
                </h3>
                <span className="font-mono text-[11px] text-ink-400">
                  {sitesLoading ? "…" : `${visibleSites.length} shown`}
                </span>
              </div>
              {sitesLoading && <Skeleton rows={3} />}
              {sitesError && (
                <ErrorLine msg="Could not load candidate sites." detail={sitesError} />
              )}
              {!sitesLoading && !sitesError && visibleSites.length === 0 && (
                <EmptyLine
                  msg={
                    filters.strict_only
                      ? "No sites pass strict v1 filters for the current selection."
                      : "No sites match the current filters."
                  }
                />
              )}
              <ul className="space-y-2">
                {visibleSites.map((s) => (
                  <SiteRow
                    key={s.id}
                    site={s}
                    onClick={() => onSelectSite(s.id)}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-line px-5 py-3 text-[11px] text-ink-400">
        v1 · deterministic filters · Gemini-generated narrative · seed data + optional NREL enrichment
      </div>
    </div>
  );
}

/* --------------------------------- Filters --------------------------------- */

function Filters({
  filters,
  setFilters,
  states,
  onSelectState,
}: {
  filters: SiteFilters;
  setFilters: Props["setFilters"];
  states: StateMacro[];
  onSelectState: (code: string | null) => void;
}) {
  return (
    <div className="space-y-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
        Filters
      </h3>

      <FieldRow label="State">
        <select
          value={filters.state_code ?? ""}
          onChange={(e) => onSelectState(e.target.value || null)}
          className="w-full rounded-md border border-line bg-bg-700 px-2.5 py-1.5 text-[13px] text-ink-50 outline-none transition focus:border-accent-solar/60"
        >
          <option value="">— All U.S. states —</option>
          {[...states]
            .sort((a, b) => a.state_name.localeCompare(b.state_name))
            .map((s) => (
              <option key={s.state_code} value={s.state_code}>
                {s.state_name}
              </option>
            ))}
        </select>
      </FieldRow>

      <Slider
        label="Min macro score"
        min={0}
        max={100}
        step={1}
        value={filters.min_macro_score ?? 0}
        onChange={(v) =>
          setFilters((f) => ({
            ...f,
            min_macro_score: v === 0 ? undefined : v,
          }))
        }
        suffix="/100"
      />
      <Slider
        label="Min solar (GHI kWh/m²/day)"
        min={3.5}
        max={7}
        step={0.1}
        value={filters.min_solar ?? 5.0}
        onChange={(v) =>
          setFilters((f) => ({ ...f, min_solar: Number(v.toFixed(1)) }))
        }
      />
      <Slider
        label="Max slope (%)"
        min={0}
        max={15}
        step={0.5}
        value={filters.max_slope ?? 5}
        onChange={(v) => setFilters((f) => ({ ...f, max_slope: v }))}
      />

      <FieldRow label="Max land-cost band">
        <select
          value={filters.max_land_cost_band ?? "moderate"}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              max_land_cost_band: e.target.value as LandCostBand,
            }))
          }
          className="w-full rounded-md border border-line bg-bg-700 px-2.5 py-1.5 text-[13px] text-ink-50 outline-none transition focus:border-accent-solar/60"
        >
          <option value="low">low</option>
          <option value="moderate">moderate</option>
          <option value="elevated">elevated</option>
          <option value="high">high</option>
        </select>
      </FieldRow>

      <label className="flex cursor-pointer items-center justify-between rounded-md border border-line bg-bg-800/60 px-3 py-2 text-[12.5px]">
        <span>
          <span className="font-medium text-ink-50">Strict only</span>
          <span className="ml-2 text-ink-400">
            hide sites that don&apos;t clear v1 rules
          </span>
        </span>
        <input
          type="checkbox"
          checked={filters.strict_only !== false}
          onChange={(e) =>
            setFilters((f) => ({ ...f, strict_only: e.target.checked }))
          }
          className="h-4 w-4 accent-accent-solar"
        />
      </label>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
  onChange: (v: number) => void;
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
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent-solar"
      />
    </div>
  );
}

/* ---------------------------------- Rows ---------------------------------- */

function StateRow({ state, onClick }: { state: StateMacro; onClick: () => void }) {
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
        <span className="flex-1 text-[13px] font-medium text-ink-50">
          {state.state_name}
        </span>
        <span className="font-mono text-[12px] text-ink-300">
          {state.macro_total_score.toFixed(1)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ink-400 group-hover:text-ink-300">
          {tierShort(state.recommended_label)}
        </span>
      </button>
    </li>
  );
}

function SiteRow({ site, onClick }: { site: CandidateSite; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="group w-full rounded-md border border-line bg-bg-800/50 px-3 py-2.5 text-left transition hover:border-accent-solar/40 hover:bg-bg-700"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink-50">
              {site.title}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400">
              GHI {site.solar_resource_value.toFixed(1)} · slope{" "}
              {site.slope_estimate.toFixed(1)}% · {site.estimated_land_cost_band}{" "}
              land · infra {site.distance_to_infra_estimate}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[13px] text-accent-solar">
              {site.overall_site_score.toFixed(0)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">
              score
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

function tierShort(label: StateMacro["recommended_label"]): string {
  return label.split(" — ")[0];
}

/* -------------------------------- UI atoms -------------------------------- */

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-md border border-line bg-bg-800/50"
        />
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
