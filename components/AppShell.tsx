"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import Sidebar from "./Sidebar";
import Legend from "./Legend";
import type {
  AnalysisRun,
  AnalyzeStateResponse,
  CandidateSite,
  Language,
  SiteFilters,
  StateMacro,
  StatesResponse,
  SitesResponse,
} from "@/types/domain";
import { directionForLanguage, normalizeLanguage, t } from "@/lib/i18n";

const DEFAULT_FILTERS: SiteFilters = {
  strict_only: true,
};
const LANGUAGE_STORAGE_KEY = "solar-land-scout:language";

export default function AppShell() {
  const [language, setLanguage] = useState<Language>("en");

  const [states, setStates] = useState<StateMacro[]>([]);
  const [statesLoading, setStatesLoading] = useState(true);
  const [statesError, setStatesError] = useState<string | null>(null);

  const [sites, setSites] = useState<CandidateSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);

  const [filters, setFilters] = useState<SiteFilters>(DEFAULT_FILTERS);
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<AnalysisRun | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [dbAvailable, setDbAvailable] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLanguage(normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;
    document.documentElement.dir = directionForLanguage(language);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatesLoading(true);
      setStatesError(null);
      try {
        const res = await fetch("/api/states", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as StatesResponse;
        if (cancelled) return;
        setStates(data.states);
        setDbAvailable(data.db_available);
      } catch (error) {
        if (!cancelled) setStatesError(error instanceof Error ? error.message : "load_failed");
      } finally {
        if (!cancelled) setStatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sitesQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedStateCode) params.set("state", selectedStateCode);
    if (typeof filters.min_solar === "number") params.set("min_solar", String(filters.min_solar));
    if (typeof filters.max_slope === "number") params.set("max_slope", String(filters.max_slope));
    if (filters.max_land_cost_band) params.set("max_land_cost_band", filters.max_land_cost_band);
    if (filters.strict_only === false) params.set("strict_only", "false");
    return params.toString();
  }, [selectedStateCode, filters]);

  const refreshSites = useCallback(async () => {
    if (!selectedStateCode) {
      setSites([]);
      setSitesError(null);
      setLatestRun(null);
      return;
    }

    setSitesLoading(true);
    setSitesError(null);
    try {
      const res = await fetch(`/api/sites?${sitesQuery}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as SitesResponse;
      setSites(data.sites);
      setLatestRun(data.latest_analysis_run);
      setDbAvailable(data.db_available);
    } catch (error) {
      setSitesError(error instanceof Error ? error.message : "load_failed");
    } finally {
      setSitesLoading(false);
    }
  }, [selectedStateCode, sitesQuery]);

  useEffect(() => {
    void refreshSites();
  }, [refreshSites]);

  const handleSelectState = useCallback((code: string | null) => {
    setSelectedStateCode(code);
    setSelectedSiteId(null);
    setAnalysisError(null);
    setFilters((current) => ({ ...current, state_code: code ?? undefined }));
  }, []);

  const handleSelectSite = useCallback((id: string | null) => {
    setSelectedSiteId(id);
  }, []);

  const handleClearState = useCallback(() => {
    setSelectedStateCode(null);
    setSelectedSiteId(null);
    setLatestRun(null);
    setSites([]);
    setAnalysisError(null);
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    if (!selectedStateCode) return;
    setAnalysisRunning(true);
    setAnalysisError(null);
    setLatestRun((current) =>
      current ?? {
        id: -1,
        state_code: selectedStateCode,
        language,
        status: "running",
        started_at: new Date().toISOString(),
        completed_at: null,
        notes: null,
        site_count: 0,
      }
    );

    try {
      const res = await fetch("/api/analyze-state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stateCode: selectedStateCode, language }),
      });
      const data = (await res.json()) as AnalyzeStateResponse;
      setDbAvailable(data.db_available);
      if (!res.ok || data.error) throw new Error(data.error ?? `status ${res.status}`);
      setSites(data.sites);
      setLatestRun(data.run);
      setSelectedSiteId(data.sites.length === 1 ? data.sites[0].id : null);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "analysis_failed");
      await refreshSites();
    } finally {
      setAnalysisRunning(false);
    }
  }, [language, refreshSites, selectedStateCode]);

  const selectedState = useMemo(
    () => states.find((state) => state.state_code === selectedStateCode) ?? null,
    [states, selectedStateCode]
  );
  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [sites, selectedSiteId]
  );

  return (
    <main className="relative h-dvh w-dvw overflow-hidden" dir={directionForLanguage(language)}>
      <div className="absolute inset-0">
        <MapView
          states={states}
          sites={sites}
          selectedStateCode={selectedStateCode}
          selectedSiteId={selectedSiteId}
          language={language}
          onSelectState={handleSelectState}
          onSelectSite={handleSelectSite}
        />
      </div>

      <header className="pointer-events-none absolute left-5 top-5 z-10 flex items-center gap-3">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-bg-800/80 px-4 py-2 backdrop-blur-md">
          <div className="relative h-6 w-6">
            <div className="absolute inset-0 rounded-full bg-accent-solar/30 blur-md" />
            <div className="absolute inset-[3px] rounded-full bg-accent-solar shadow-glow" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide">Solar Land Scout</div>
            <div className="text-[11px] text-ink-400">{t(language, "app.subtitle")}</div>
          </div>
          <button
            onClick={() => setLanguage((current) => (current === "en" ? "he" : "en"))}
            className="rounded-full border border-line bg-bg-700 px-3 py-1 text-[11px] font-medium text-ink-100 transition hover:border-accent-solar/40 hover:text-accent-solar"
          >
            {t(language, "language.toggle")}
          </button>
        </div>
      </header>

      <div className="pointer-events-none absolute bottom-5 left-5 z-10">
        <div className="pointer-events-auto">
          <Legend language={language} />
        </div>
      </div>

      <aside className="absolute right-0 top-0 z-20 h-full w-full max-w-[440px] border-l border-line bg-bg-900/90 backdrop-blur-xl">
        <Sidebar
          language={language}
          states={states}
          statesLoading={statesLoading}
          statesError={statesError}
          sites={sites}
          sitesLoading={sitesLoading}
          sitesError={sitesError}
          filters={filters}
          setFilters={setFilters}
          selectedState={selectedState}
          selectedSite={selectedSite}
          latestRun={latestRun}
          analysisRunning={analysisRunning}
          analysisError={analysisError}
          dbAvailable={dbAvailable}
          onSelectState={handleSelectState}
          onSelectSite={handleSelectSite}
          onClearState={handleClearState}
          onRunAnalysis={handleRunAnalysis}
        />
      </aside>
    </main>
  );
}
