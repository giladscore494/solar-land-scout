"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView, { mapboxTokenConfigured } from "./MapView";
import Sidebar from "./Sidebar";
import Legend from "./Legend";
import { useScanController } from "./ScanController";
import type {
  AnalysisRun,
  CandidateSite,
  SiteFilters,
  StateMacro,
  StatesResponse,
  SitesResponse,
} from "@/types/domain";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";

const DEFAULT_FILTERS: SiteFilters = { strict_only: true };

export default function AppShell() {
  const [language, setLanguage] = useState<Lang>("en");
  const [states, setStates] = useState<StateMacro[]>([]);
  const [statesLoading, setStatesLoading] = useState(true);
  const [statesError, setStatesError] = useState<string | null>(null);

  const [sites, setSites] = useState<CandidateSite[]>([]);
  const [allCandidates, setAllCandidates] = useState<CandidateSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);

  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [runDebug, setRunDebug] = useState<Record<string, unknown> | null>(null);

  const [filters, setFilters] = useState<SiteFilters>(DEFAULT_FILTERS);
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  // SSE scan controller
  const scanController = useScanController();

  // Mobile: panel open/closed. On large screens the panel is always visible.
  const [panelOpen, setPanelOpen] = useState(false);
  // Basemap: dark choropleth vs Mapbox satellite raster.
  const [basemap, setBasemap] = useState<"dark" | "satellite">("dark");

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
    return () => {
      cancelled = true;
    };
  }, []);

  // Include enrichment-related filter query params.
  const sitesQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (selectedStateCode) p.set("state", selectedStateCode);
    if (typeof filters.min_solar === "number") p.set("min_solar", String(filters.min_solar));
    if (typeof filters.max_slope === "number") p.set("max_slope", String(filters.max_slope));
    if (filters.max_land_cost_band) p.set("max_land_cost_band", filters.max_land_cost_band);
    if (filters.strict_only === false) p.set("strict_only", "false");
    if (filters.hide_protected === false) p.set("hide_protected", "false");
    if (filters.hide_flood === false) p.set("hide_flood", "false");
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
      setAllCandidates([]);
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
        if (!cancelled) {
          setSites(data.sites);
          setAllCandidates(data.sites);
        }
      } catch (e) {
        if (!cancelled) setSitesError(e instanceof Error ? e.message : "load_failed");
      } finally {
        if (!cancelled) setSitesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sitesQuery, selectedStateCode, refreshRuns]);

  const handleRunAnalysis = useCallback(async () => {
    if (!selectedStateCode) return;

    // Use SSE scan controller — opens panel automatically
    setPanelOpen(true);
    scanController.start(selectedStateCode);

    // Also set legacy runStatus so UI buttons disable correctly
    setRunStatus("running");
    setRunError(null);
  }, [selectedStateCode, scanController, setPanelOpen]);

  useEffect(() => {
    const passedSites = scanController.state.passedSites;
    if (passedSites.length === 0) return;
    setSites((prev) => {
      const ids = new Set(passedSites.map((s) => s.id));
      return [...prev.filter((s) => !ids.has(s.id)), ...passedSites];
    });
    setAllCandidates((prev) => {
      const ids = new Set(passedSites.map((s) => s.id));
      return [...prev.filter((s) => !ids.has(s.id)), ...passedSites];
    });
  }, [scanController.state.passedSites]);

  // When scan completes, refresh sites and update legacy state
  useEffect(() => {
    if (scanController.state.status === "done") {
      setRunDebug({
        state_code: selectedStateCode,
        engine: scanController.state.engine,
        requested_engine: scanController.state.requestedEngine,
        fallback_reason: scanController.state.fallbackReason,
        db_health: scanController.state.dbHealth,
        total_generated: scanController.state.progress.total,
        total_passing_strict: scanController.state.tally.passed,
        rejected_by: scanController.state.tally.rejected_by,
      });
      setRunStatus("complete");
      if (selectedStateCode) {
        refreshRuns(selectedStateCode).catch(() => undefined);
      }
    } else if (scanController.state.status === "error") {
      setRunStatus("error");
      setRunError(scanController.state.errorMessage ?? "scan_failed");
    } else if (scanController.state.status === "cancelled") {
      setRunStatus("idle");
      setRunError(null);
    } else if (scanController.state.status === "scanning") {
      setRunStatus("running");
    }
  }, [
    scanController.state.status,
    scanController.state.engine,
    scanController.state.requestedEngine,
    scanController.state.fallbackReason,
    scanController.state.dbHealth,
    scanController.state.progress.total,
    scanController.state.tally,
    scanController.state.errorMessage,
    selectedStateCode,
    refreshRuns,
  ]);

  const handleSelectState = useCallback((code: string | null) => {
    setSelectedStateCode(code);
    setSelectedSiteId(null);
    setRunStatus("idle");
    setRunError(null);
    setRunDebug(null);
    setAllCandidates([]);
    setFilters((f) => ({ ...f, state_code: code ?? undefined }));
    // On mobile, opening the panel after selection gives users immediate feedback.
    setPanelOpen(true);
  }, []);

  const handleSelectSite = useCallback((id: string | null) => {
    setSelectedSiteId(id);
    if (id) setPanelOpen(true);
  }, []);

  const selectedState = useMemo(
    () => states.find((s) => s.state_code === selectedStateCode) ?? null,
    [states, selectedStateCode]
  );
  const selectedSite = useMemo(
    () =>
      sites.find((s) => s.id === selectedSiteId) ??
      allCandidates.find((s) => s.id === selectedSiteId) ??
      null,
    [sites, allCandidates, selectedSiteId]
  );

  const isRtl = language === "he";

  return (
    <main
      className="relative h-dvh w-dvw overflow-hidden bg-bg-900"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Full-bleed map */}
      <div className="absolute inset-0">
        <MapView
          states={states}
          sites={sites}
          selectedStateCode={selectedStateCode}
          selectedSiteId={selectedSiteId}
          onSelectState={handleSelectState}
          onSelectSite={handleSelectSite}
          basemap={basemap}
          scanState={scanController.state}
        />
      </div>

      {/* Basemap toggle (top-right of the map) */}
      {mapboxTokenConfigured && (
        <div
          className={
            "pointer-events-auto absolute top-3 z-30 sm:top-5 " +
            (isRtl ? "left-20 sm:left-24" : "right-20 sm:right-24")
          }
        >
          <div className="flex overflow-hidden rounded-full border border-line bg-bg-800/85 text-[11px] backdrop-blur-md">
            <button
              type="button"
              onClick={() => setBasemap("dark")}
              className={
                "min-h-[30px] px-3 py-1 transition " +
                (basemap === "dark"
                  ? "bg-bg-700 text-ink-50"
                  : "text-ink-300 hover:text-ink-100")
              }
              aria-pressed={basemap === "dark"}
            >
              Dark
            </button>
            <button
              type="button"
              onClick={() => setBasemap("satellite")}
              className={
                "min-h-[30px] px-3 py-1 transition " +
                (basemap === "satellite"
                  ? "bg-bg-700 text-ink-50"
                  : "text-ink-300 hover:text-ink-100")
              }
              aria-pressed={basemap === "satellite"}
            >
              Satellite
            </button>
          </div>
        </div>
      )}

      {/* Header chip — keeps title + language. On mobile it's compact. */}
      <header
        className={
          "pointer-events-none absolute top-3 z-30 flex items-center gap-2 sm:top-5 " +
          (isRtl ? "right-3 sm:right-5" : "left-3 sm:left-5")
        }
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-bg-800/85 px-3 py-1.5 backdrop-blur-md sm:gap-3 sm:px-4 sm:py-2">
          <div className="leading-tight">
            <div className="text-[12px] font-semibold tracking-wide sm:text-[13px]">
              Solar Land Scout
            </div>
            <div className="hidden text-[11px] text-ink-400 sm:block">
              Feasibility pre-screening
            </div>
          </div>
          <button
            type="button"
            className="min-h-[34px] min-w-[34px] rounded-md border border-line px-2 py-1 text-[11px] font-medium active:scale-[0.97]"
            onClick={() => setLanguage((l) => (l === "en" ? "he" : "en"))}
            aria-label="Toggle language"
          >
            {language === "en" ? "HE" : "EN"}
          </button>
        </div>
      </header>

      {/* Mobile action button to open the panel */}
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className={
          "pointer-events-auto fixed bottom-[max(12px,env(safe-area-inset-bottom))] z-30 rounded-full border border-line bg-bg-800/90 px-4 py-2 text-[12px] font-semibold shadow-panel backdrop-blur-md active:scale-[0.98] lg:hidden " +
          (isRtl ? "left-3" : "right-3")
        }
        aria-label={t(language, "showPanel")}
      >
        {selectedState
          ? selectedSite
            ? selectedSite.title.slice(0, 22)
            : selectedState.state_name
          : t(language, "usaOverview")}
      </button>

      {/* Legend — hidden on very small screens to keep the map breathable */}
      <div
        className={
          "pointer-events-none absolute bottom-[max(12px,env(safe-area-inset-bottom))] z-20 hidden sm:block " +
          (isRtl ? "right-3 sm:right-5" : "left-3 sm:left-5")
        }
      >
        <div className="pointer-events-auto">
          <Legend showExcluded={filters.strict_only === false} />
        </div>
      </div>

      {/* Panel: desktop side drawer, mobile bottom sheet */}
      <aside
        className={[
          "fixed z-40 border-line bg-bg-900/95 backdrop-blur-xl transition-transform duration-300 ease-out",
          // Mobile: bottom sheet
          "inset-x-0 bottom-0 h-[min(88vh,760px)] rounded-t-2xl border-t",
          panelOpen ? "translate-y-0" : "translate-y-full",
          // Desktop: right (or left, when RTL) side drawer
          "lg:inset-auto lg:top-0 lg:h-full lg:w-[min(430px,36vw)] lg:rounded-none lg:border-t-0 lg:!translate-y-0",
          isRtl
            ? "lg:left-0 lg:border-r lg:border-l-0"
            : "lg:right-0 lg:border-l",
        ].join(" ")}
        role="dialog"
        aria-modal="false"
      >
        <Sidebar
          language={language}
          states={states}
          statesLoading={statesLoading}
          statesError={statesError}
          sites={sites}
          allCandidates={allCandidates}
          sitesLoading={sitesLoading}
          sitesError={sitesError}
          runs={runs}
          runStatus={runStatus}
          runError={runError}
          onRunAnalysis={handleRunAnalysis}
          runDebug={runDebug}
          filters={filters}
          setFilters={setFilters}
          selectedState={selectedState}
          selectedSite={selectedSite}
          onSelectState={handleSelectState}
          onSelectSite={handleSelectSite}
          onClearState={() => handleSelectState(null)}
          onRequestClose={() => setPanelOpen(false)}
          scanState={scanController.state}
          onCancelScan={scanController.cancel}
        />
      </aside>
    </main>
  );
}
