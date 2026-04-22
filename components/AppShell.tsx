"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import Sidebar from "./Sidebar";
import Legend from "./Legend";
import type { AnalysisRun, CandidateSite, SiteFilters, StateMacro, StatesResponse, SitesResponse } from "@/types/domain";
import type { Lang } from "@/lib/i18n";

const DEFAULT_FILTERS: SiteFilters = { strict_only: true };

export default function AppShell() {
  const [language, setLanguage] = useState<Lang>("en");
  const [states, setStates] = useState<StateMacro[]>([]);
  const [statesLoading, setStatesLoading] = useState(true);
  const [statesError, setStatesError] = useState<string | null>(null);

  const [sites, setSites] = useState<CandidateSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);

  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [activeDebugJson, setActiveDebugJson] = useState<Record<string, unknown> | null>(null);

  const [filters, setFilters] = useState<SiteFilters>(DEFAULT_FILTERS);
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatesLoading(true);
      setStatesError(null);
      try {
        const res = await fetch("/api/states", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as StatesResponse;
        if (!cancelled) setStates(data.states);
      } catch (e) {
        if (!cancelled) setStatesError(e instanceof Error ? e.message : "load_failed");
      } finally {
        if (!cancelled) setStatesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sitesQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (selectedStateCode) p.set("state", selectedStateCode);
    if (typeof filters.min_solar === "number") p.set("min_solar", String(filters.min_solar));
    if (typeof filters.max_slope === "number") p.set("max_slope", String(filters.max_slope));
    if (filters.max_land_cost_band) p.set("max_land_cost_band", filters.max_land_cost_band);
    if (filters.strict_only === false) p.set("strict_only", "false");
    return p.toString();
  }, [selectedStateCode, filters]);

  const refreshRuns = useCallback(async (stateCode: string) => {
    const res = await fetch(`/api/analysis-runs?state=${stateCode}`, { cache: "no-store" });
    const data = (await res.json()) as { runs: AnalysisRun[] };
    setRuns(data.runs ?? []);
  }, []);

  useEffect(() => {
    if (!selectedStateCode) {
      setSites([]);
      setRuns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setSitesLoading(true);
      setSitesError(null);
      try {
        const [sitesRes] = await Promise.all([
          fetch(`/api/sites?${sitesQuery}`, { cache: "no-store" }),
          refreshRuns(selectedStateCode),
        ]);
        if (!sitesRes.ok) throw new Error(`status ${sitesRes.status}`);
        const data = (await sitesRes.json()) as SitesResponse;
        if (!cancelled) setSites(data.sites);
      } catch (e) {
        if (!cancelled) setSitesError(e instanceof Error ? e.message : "load_failed");
      } finally {
        if (!cancelled) setSitesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sitesQuery, selectedStateCode, refreshRuns]);

  const handleRunAnalysis = useCallback(async () => {
    if (!selectedStateCode) return;
    setRunStatus("running");
    setRunError(null);
    try {
      const res = await fetch("/api/analyze-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state_code: selectedStateCode, language }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { sites: CandidateSite[] };
      setSites(data.sites ?? []);
      setActiveDebugJson((data.sites?.[0]?.gemini_debug_json as Record<string, unknown>) ?? null);
      setRunStatus("complete");
      await refreshRuns(selectedStateCode);
    } catch (e) {
      setRunStatus("error");
      setRunError(e instanceof Error ? e.message : "analysis_failed");
    }
  }, [selectedStateCode, language, refreshRuns]);

  const handleSelectState = useCallback((code: string | null) => {
    setSelectedStateCode(code);
    setSelectedSiteId(null);
    setRunStatus("idle");
    setRunError(null);
    setActiveDebugJson(null);
    setFilters((f) => ({ ...f, state_code: code ?? undefined }));
  }, []);

  const selectedState = useMemo(() => states.find((s) => s.state_code === selectedStateCode) ?? null, [states, selectedStateCode]);
  const selectedSite = useMemo(() => sites.find((s) => s.id === selectedSiteId) ?? null, [sites, selectedSiteId]);

  return (
    <main className="relative h-dvh w-dvw overflow-hidden" dir={language === "he" ? "rtl" : "ltr"}>
      <div className="absolute inset-0">
        <MapView
          states={states}
          sites={sites}
          selectedStateCode={selectedStateCode}
          selectedSiteId={selectedSiteId}
          onSelectState={handleSelectState}
          onSelectSite={setSelectedSiteId}
        />
      </div>

      <header className="pointer-events-none absolute left-5 top-5 z-10 flex items-center gap-3">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-bg-800/80 px-4 py-2 backdrop-blur-md">
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide">Solar Land Scout</div>
            <div className="text-[11px] text-ink-400">Feasibility pre-screening</div>
          </div>
          <button
            className="rounded border border-line px-2 py-1 text-[11px]"
            onClick={() => setLanguage((l) => (l === "en" ? "he" : "en"))}
          >
            {language === "en" ? "HE" : "EN"}
          </button>
        </div>
      </header>

      <div className="pointer-events-none absolute bottom-5 left-5 z-10"><div className="pointer-events-auto"><Legend /></div></div>

      <aside className="absolute right-0 top-0 z-20 h-full w-full max-w-[430px] border-l border-line bg-bg-900/90 backdrop-blur-xl">
        <Sidebar
          language={language}
          states={states}
          statesLoading={statesLoading}
          statesError={statesError}
          sites={sites}
          sitesLoading={sitesLoading}
          sitesError={sitesError}
          runs={runs}
          runStatus={runStatus}
          runError={runError}
          onRunAnalysis={handleRunAnalysis}
          debugJson={activeDebugJson}
          filters={filters}
          setFilters={setFilters}
          selectedState={selectedState}
          selectedSite={selectedSite}
          onSelectState={handleSelectState}
          onSelectSite={setSelectedSiteId}
          onClearState={() => handleSelectState(null)}
        />
      </aside>
    </main>
  );
}
