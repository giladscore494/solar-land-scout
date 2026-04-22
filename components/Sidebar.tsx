"use client";

import { type ReactNode, useMemo, useState } from "react";
import type { AnalysisRun, CandidateSite, LandCostBand, SiteFilters, StateMacro } from "@/types/domain";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import StateDetail from "./StateDetail";
import SiteDetail from "./SiteDetail";
import { colorForScore } from "@/lib/color-ramp";

interface Props {
  language: Lang;
  states: StateMacro[];
  statesLoading: boolean;
  statesError: string | null;
  sites: CandidateSite[];
  sitesLoading: boolean;
  sitesError: string | null;
  runs: AnalysisRun[];
  runStatus: "idle" | "running" | "complete" | "error";
  runError: string | null;
  onRunAnalysis: () => void;
  debugJson: Record<string, unknown> | null;
  filters: SiteFilters;
  setFilters: (updater: (prev: SiteFilters) => SiteFilters) => void;
  selectedState: StateMacro | null;
  selectedSite: CandidateSite | null;
  onSelectState: (code: string | null) => void;
  onSelectSite: (id: string | null) => void;
  onClearState: () => void;
}

export default function Sidebar(props: Props) {
  const [debugOpen, setDebugOpen] = useState(false);
  const { language, states, statesLoading, statesError, sites, sitesLoading, sitesError, runs, runStatus, runError, onRunAnalysis, debugJson, filters, setFilters, selectedState, selectedSite, onSelectState, onSelectSite, onClearState } = props;

  const visibleSites = useMemo(() => sites, [sites]);
  const topStates = useMemo(() => [...states].sort((a, b) => b.macro_total_score - a.macro_total_score).slice(0, 8), [states]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 pb-4 pt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
            {selectedState ? t(language, "stateIntelligence") : t(language, "usaOverview")}
          </h2>
          {selectedState && <button onClick={onClearState} className="text-[11px]">←</button>}
        </div>
      </div>

      <div className="scroll-panel flex-1 overflow-y-auto px-5 py-5">
        <Filters filters={filters} setFilters={setFilters} states={states} onSelectState={onSelectState} />
        <div className="my-4 h-px bg-line" />

        {!selectedState ? (
          <>
            {statesLoading && <div>Loading…</div>}
            {statesError && <div>{statesError}</div>}
            <ul className="space-y-2">{topStates.map((s) => <StateRow key={s.state_code} state={s} onClick={() => onSelectState(s.state_code)} />)}</ul>
          </>
        ) : selectedSite ? (
          <SiteDetail site={selectedSite} onBack={() => onSelectSite(null)} />
        ) : (
          <>
            <StateDetail state={selectedState} />

            <button onClick={onRunAnalysis} disabled={runStatus === "running"} className="mt-4 w-full rounded-lg border border-accent-solar/60 bg-accent-solar/15 px-3 py-2 text-sm font-semibold">
              {runStatus === "running" ? t(language, "running") : t(language, "runAnalysis")}
            </button>
            {runStatus === "complete" && <div className="mt-2 text-xs text-emerald-300">{t(language, "complete")}</div>}
            {runStatus === "error" && <div className="mt-2 text-xs text-red-300">{runError ?? "analysis error"}</div>}

            <div className="mt-3 text-xs text-ink-400">Runs: {runs.length}</div>

            <div className="mt-6">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">Candidate sites</h3>
                <span className="font-mono text-[11px] text-ink-400">{sitesLoading ? "…" : `${visibleSites.length}`}</span>
              </div>
              {sitesError && <div className="text-xs text-red-300">{sitesError}</div>}
              {!sitesLoading && !sitesError && visibleSites.length === 0 && <div className="text-xs text-ink-400">{t(language, "noResults")}</div>}
              <ul className="space-y-2">{visibleSites.map((s) => <SiteRow key={s.id} site={s} onClick={() => onSelectSite(s.id)} />)}</ul>
            </div>

            <div className="mt-6 rounded-lg border border-line bg-bg-800/40 p-2">
              <button className="flex w-full items-center justify-between text-xs" onClick={() => setDebugOpen((x) => !x)}>
                <span>{t(language, "debugJson")}</span><span>{debugOpen ? "▾" : "▸"}</span>
              </button>
              {debugOpen && <pre className="mt-2 max-h-40 overflow-auto text-[10px] text-ink-300">{JSON.stringify(debugJson, null, 2)}</pre>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Filters({ filters, setFilters, states, onSelectState }: { filters: SiteFilters; setFilters: Props["setFilters"]; states: StateMacro[]; onSelectState: (code: string | null) => void }) {
  return (
    <div className="space-y-3.5">
      <FieldRow label="State">
        <select value={filters.state_code ?? ""} onChange={(e) => onSelectState(e.target.value || null)} className="w-full rounded-md border border-line bg-bg-700 px-2.5 py-1.5 text-[13px] text-ink-50">
          <option value="">— All U.S. states —</option>
          {[...states].sort((a, b) => a.state_name.localeCompare(b.state_name)).map((s) => <option key={s.state_code} value={s.state_code}>{s.state_name}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Max land-cost band">
        <select value={filters.max_land_cost_band ?? "moderate"} onChange={(e) => setFilters((f) => ({ ...f, max_land_cost_band: e.target.value as LandCostBand }))} className="w-full rounded-md border border-line bg-bg-700 px-2.5 py-1.5 text-[13px] text-ink-50">
          <option value="low">low</option><option value="moderate">moderate</option><option value="elevated">elevated</option><option value="high">high</option>
        </select>
      </FieldRow>
    </div>
  );
}

function StateRow({ state, onClick }: { state: StateMacro; onClick: () => void }) {
  return <button onClick={onClick} className="w-full rounded-md border border-line/70 bg-bg-800/70 px-3 py-2 text-left"><div className="text-sm">{state.state_name}</div><div className="text-xs" style={{ color: colorForScore(state.macro_total_score) }}>{state.macro_total_score.toFixed(1)}</div></button>;
}
function SiteRow({ site, onClick }: { site: CandidateSite; onClick: () => void }) {
  return <button onClick={onClick} className="w-full rounded-md border border-line/70 bg-bg-800/70 px-3 py-2 text-left"><div className="text-sm">{site.title}</div><div className="text-xs text-ink-300">Feasibility {site.feasibility_score ?? site.overall_site_score}</div></button>;
}
function FieldRow({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-ink-400">{label}</div>{children}</label>; }
