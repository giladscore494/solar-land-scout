"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import Sidebar from "./Sidebar";
import Legend from "./Legend";
import type {
  CandidateSite,
  SiteFilters,
  StateMacro,
  StatesResponse,
  SitesResponse,
} from "@/types/domain";

const DEFAULT_FILTERS: SiteFilters = {
  strict_only: true,
};

/**
 * Top-level client component: owns data loading + selection state.
 * Renders the full-screen map on the left, persistent sidebar on the right.
 */
export default function AppShell() {
  const [states, setStates] = useState<StateMacro[]>([]);
  const [statesLoading, setStatesLoading] = useState(true);
  const [statesError, setStatesError] = useState<string | null>(null);

  const [sites, setSites] = useState<CandidateSite[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);

  const [filters, setFilters] = useState<SiteFilters>(DEFAULT_FILTERS);
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  /* ---------------------------- initial states load --------------------------- */

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
        if (!cancelled)
          setStatesError(e instanceof Error ? e.message : "load_failed");
      } finally {
        if (!cancelled) setStatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------------------- sites load (reactive) ------------------------- */

  const sitesQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (selectedStateCode) p.set("state", selectedStateCode);
    if (typeof filters.min_solar === "number")
      p.set("min_solar", String(filters.min_solar));
    if (typeof filters.max_slope === "number")
      p.set("max_slope", String(filters.max_slope));
    if (filters.max_land_cost_band) p.set("max_land_cost_band", filters.max_land_cost_band);
    if (filters.strict_only === false) p.set("strict_only", "false");
    return p.toString();
  }, [selectedStateCode, filters]);

  useEffect(() => {
    // Only fetch sites when a state is selected. On the full-USA view the map
    // shows the state-level choropleth and no points, which is the intended UX.
    if (!selectedStateCode) {
      setSites([]);
      setSitesError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setSitesLoading(true);
      setSitesError(null);
      try {
        const res = await fetch(`/api/sites?${sitesQuery}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as SitesResponse;
        if (!cancelled) setSites(data.sites);
      } catch (e) {
        if (!cancelled)
          setSitesError(e instanceof Error ? e.message : "load_failed");
      } finally {
        if (!cancelled) setSitesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sitesQuery, selectedStateCode]);

  /* ---------------------------------- Actions --------------------------------- */

  const handleSelectState = useCallback((code: string | null) => {
    setSelectedStateCode(code);
    setSelectedSiteId(null);
    setFilters((f) => ({ ...f, state_code: code ?? undefined }));
  }, []);

  const handleSelectSite = useCallback((id: string | null) => {
    setSelectedSiteId(id);
  }, []);

  const handleClearState = useCallback(() => {
    setSelectedStateCode(null);
    setSelectedSiteId(null);
  }, []);

  const selectedState = useMemo(
    () => states.find((s) => s.state_code === selectedStateCode) ?? null,
    [states, selectedStateCode]
  );
  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) ?? null,
    [sites, selectedSiteId]
  );

  /* ----------------------------------- UI ------------------------------------ */

  return (
    <main className="relative h-dvh w-dvw overflow-hidden">
      {/* Map fills everything; sidebar floats over it on desktop. */}
      <div className="absolute inset-0">
        <MapView
          states={states}
          sites={sites}
          selectedStateCode={selectedStateCode}
          selectedSiteId={selectedSiteId}
          onSelectState={handleSelectState}
          onSelectSite={handleSelectSite}
        />
      </div>

      {/* Top-left brand */}
      <header className="pointer-events-none absolute left-5 top-5 z-10 flex items-center gap-3">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-bg-800/80 px-4 py-2 backdrop-blur-md">
          <div className="relative h-6 w-6">
            <div className="absolute inset-0 rounded-full bg-accent-solar/30 blur-md" />
            <div className="absolute inset-[3px] rounded-full bg-accent-solar shadow-glow" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide">Solar Land Scout</div>
            <div className="text-[11px] text-ink-400">U.S. utility-scale site discovery · v1</div>
          </div>
        </div>
      </header>

      {/* Legend bottom-left */}
      <div className="pointer-events-none absolute bottom-5 left-5 z-10">
        <div className="pointer-events-auto">
          <Legend />
        </div>
      </div>

      {/* Sidebar */}
      <aside className="absolute right-0 top-0 z-20 h-full w-full max-w-[420px] border-l border-line bg-bg-900/90 backdrop-blur-xl">
        <Sidebar
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
          onSelectState={handleSelectState}
          onSelectSite={handleSelectSite}
          onClearState={handleClearState}
        />
      </aside>
    </main>
  );
}
