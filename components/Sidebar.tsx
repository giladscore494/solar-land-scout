"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  AnalysisRun,
  CandidateSite,
  LandCostBand,
  SiteFilters,
  StateMacro,
} from "@/types/domain";
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
  allCandidates: CandidateSite[];
  sitesLoading: boolean;
  sitesError: string | null;
  runs: AnalysisRun[];
  runStatus: "idle" | "running" | "complete" | "error";
  runError: string | null;
  onRunAnalysis: () => void;
  runDebug: Record<string, unknown> | null;
  filters: SiteFilters;
  setFilters: (updater: (prev: SiteFilters) => SiteFilters) => void;
  selectedState: StateMacro | null;
  selectedSite: CandidateSite | null;
  onSelectState: (code: string | null) => void;
  onSelectSite: (id: string | null) => void;
  onClearState: () => void;
  onRequestClose: () => void;
}

export default function Sidebar(props: Props) {
  const {
    language,
    states,
    statesLoading,
    statesError,
    sites,
    allCandidates,
    sitesLoading,
    sitesError,
    runs,
    runStatus,
    runError,
    onRunAnalysis,
    runDebug,
    filters,
    setFilters,
    selectedState,
    selectedSite,
    onSelectState,
    onSelectSite,
    onClearState,
    onRequestClose,
  } = props;

  const visibleSites = sites;
  const topStates = useMemo(
    () => [...states].sort((a, b) => b.macro_total_score - a.macro_total_score).slice(0, 8),
    [states]
  );

  const hasAnyCandidate = allCandidates.length > 0;
  const noneVisible = !sitesLoading && !sitesError && visibleSites.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Drag handle (mobile) */}
      <div className="flex shrink-0 justify-center pt-2 lg:hidden">
        <button
          type="button"
          aria-label={t(language, "close")}
          onClick={onRequestClose}
          className="h-1.5 w-12 rounded-full bg-line"
        />
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 pb-3 pt-3 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 items-center gap-2">
          {selectedState && (
            <button
              type="button"
              onClick={onClearState}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-[14px] active:scale-[0.97]"
              aria-label={t(language, "back")}
            >
              ←
            </button>
          )}
          <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
            {selectedState ? t(language, "stateIntelligence") : t(language, "usaOverview")}
          </h2>
        </div>
        <button
          type="button"
          onClick={onRequestClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-[14px] active:scale-[0.97] lg:hidden"
          aria-label={t(language, "close")}
        >
          ×
        </button>
      </div>

      <div className="scroll-panel flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pt-5">
        <Filters
          filters={filters}
          setFilters={setFilters}
          states={states}
          onSelectState={onSelectState}
          language={language}
        />
        <div className="my-4 h-px bg-line" />

        {!selectedState ? (
          <>
            {statesLoading && <div className="text-[13px] text-ink-300">Loading…</div>}
            {statesError && <div className="text-[13px] text-red-300">{statesError}</div>}
            <ul className="space-y-2">
              {topStates.map((s) => (
                <StateRow
                  key={s.state_code}
                  state={s}
                  onClick={() => onSelectState(s.state_code)}
                />
              ))}
            </ul>
          </>
        ) : selectedSite ? (
          <SiteDetail site={selectedSite} onBack={() => onSelectSite(null)} />
        ) : (
          <>
            <StateDetail state={selectedState} />

            <button
              type="button"
              onClick={onRunAnalysis}
              disabled={runStatus === "running"}
              className="mt-4 min-h-[44px] w-full rounded-lg border border-accent-solar/60 bg-accent-solar/15 px-3 py-2.5 text-[14px] font-semibold text-ink-50 transition active:scale-[0.99] disabled:opacity-60"
            >
              {runStatus === "running"
                ? t(language, "running")
                : t(language, "runAnalysis")}
            </button>
            {runStatus === "complete" && (
              <div className="mt-2 text-[12px] text-emerald-300">
                {t(language, "complete")}
              </div>
            )}
            {runStatus === "error" && (
              <div className="mt-2 text-[12px] text-red-300">
                {runError ?? "analysis error"}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between text-[11.5px] text-ink-400">
              <span>Runs: {runs.length}</span>
              {runDebug && (
                <GroundingBadge runDebug={runDebug} language={language} />
              )}
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400">
                  {t(language, "candidateSites")}
                </h3>
                <span className="font-mono text-[11px] text-ink-400">
                  {sitesLoading ? "…" : `${visibleSites.length}`}
                </span>
              </div>
              {sitesError && (
                <div className="text-[12px] text-red-300">{sitesError}</div>
              )}
              {noneVisible && (
                <div className="rounded-md border border-line bg-bg-800/40 px-3 py-2 text-[12px] text-ink-300">
                  {t(language, "noResults")}
                  {hasAnyCandidate && (
                    <div className="mt-1 text-[11.5px] text-ink-400">
                      {t(language, "noPassingHint")}
                    </div>
                  )}
                </div>
              )}
              <ul className="mt-2 space-y-2">
                {visibleSites.map((s) => (
                  <SiteRow key={s.id} site={s} onClick={() => onSelectSite(s.id)} />
                ))}
              </ul>
            </div>

            {/* Run-level + per-site debug */}
            {(runDebug || hasAnyCandidate) && (
              <DebugSection
                language={language}
                runDebug={runDebug}
                allCandidates={allCandidates}
                onSelectSite={onSelectSite}
              />
            )}
          </>
        )}
        <SystemStatus />
      </div>
    </div>
  );
}

function Filters({
  filters,
  setFilters,
  states,
  onSelectState,
  language,
}: {
  filters: SiteFilters;
  setFilters: Props["setFilters"];
  states: StateMacro[];
  onSelectState: (code: string | null) => void;
  language: Lang;
}) {
  const strictOnly = filters.strict_only !== false;
  const hideProt = filters.hide_protected !== false;
  const hideFlood = filters.hide_flood !== false;
  return (
    <div className="space-y-3.5">
      <FieldRow label={t(language, "stateLabel")}>
        <select
          value={filters.state_code ?? ""}
          onChange={(e) => onSelectState(e.target.value || null)}
          className="min-h-[42px] w-full rounded-md border border-line bg-bg-700 px-2.5 py-2 text-[14px] text-ink-50"
        >
          <option value="">{t(language, "selectState")}</option>
          {[...states]
            .sort((a, b) => a.state_name.localeCompare(b.state_name))
            .map((s) => (
              <option key={s.state_code} value={s.state_code}>
                {s.state_name}
              </option>
            ))}
        </select>
      </FieldRow>
      <FieldRow label={t(language, "maxLandCost")}>
        <select
          value={filters.max_land_cost_band ?? "moderate"}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              max_land_cost_band: e.target.value as LandCostBand,
            }))
          }
          className="min-h-[42px] w-full rounded-md border border-line bg-bg-700 px-2.5 py-2 text-[14px] text-ink-50"
        >
          <option value="low">low</option>
          <option value="moderate">moderate</option>
          <option value="elevated">elevated</option>
          <option value="high">high</option>
        </select>
      </FieldRow>

      {/* Hard-exclusion toggles. Implicit when strict_only=true. */}
      <div className="space-y-1.5 pt-1">
        <ToggleRow
          label="Hide protected areas"
          checked={hideProt}
          disabled={strictOnly}
          onChange={(v) =>
            setFilters((f) => ({ ...f, hide_protected: v }))
          }
        />
        <ToggleRow
          label="Hide flood zones"
          checked={hideFlood}
          disabled={strictOnly}
          onChange={(v) => setFilters((f) => ({ ...f, hide_flood: v }))}
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={
        "flex items-center justify-between gap-3 rounded-md border border-line bg-bg-800/40 px-3 py-2 text-[12.5px] " +
        (disabled ? "opacity-60" : "")
      }
    >
      <span className="text-ink-200">{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent-solar"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function StateRow({ state, onClick }: { state: StateMacro; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-md border border-line/70 bg-bg-800/70 px-3 py-2.5 text-left transition active:scale-[0.99] hover:border-line"
    >
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-ink-50">
          {state.state_name}
        </div>
        <div className="text-[11px] text-ink-400">{state.recommended_label}</div>
      </div>
      <div
        className="shrink-0 font-mono text-[13px]"
        style={{ color: colorForScore(state.macro_total_score) }}
      >
        {state.macro_total_score.toFixed(1)}
      </div>
    </button>
  );
}

function SiteRow({ site, onClick }: { site: CandidateSite; onClick: () => void }) {
  const score = site.feasibility_score ?? site.overall_site_score;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-md border border-line/70 bg-bg-800/70 px-3 py-2.5 text-left transition active:scale-[0.99] hover:border-line"
    >
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-ink-50">
          {site.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-400">
          <span>{site.state_code}</span>
          <span>·</span>
          <span>{site.estimated_land_cost_band}</span>
          <span>·</span>
          <span>{site.distance_to_infra_estimate}</span>
        </div>
      </div>
      <div
        className="shrink-0 rounded-md border border-line/80 bg-bg-900/70 px-2 py-1 font-mono text-[12px]"
        style={{ color: colorForScore(score) }}
      >
        {score.toFixed(0)}
      </div>
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-ink-400">
        {label}
      </div>
      {children}
    </label>
  );
}

function GroundingBadge({
  runDebug,
  language,
}: {
  runDebug: Record<string, unknown>;
  language: Lang;
}) {
  const used = Number(runDebug.grounding_uses ?? 0);
  const attempts = Number(runDebug.grounding_attempts ?? 0);
  if (used > 0) {
    return (
      <span className="rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 text-[10.5px] font-medium text-accent-cyan">
        {t(language, "groundingUsed")} · {used}/{attempts}
      </span>
    );
  }
  if (attempts > 0) {
    return (
      <span className="rounded-full border border-line bg-bg-700 px-2 py-0.5 text-[10.5px] font-medium text-ink-400">
        {t(language, "groundingAttempted")} · {attempts}
      </span>
    );
  }
  return null;
}

function DebugSection({
  language,
  runDebug,
  allCandidates,
  onSelectSite,
}: {
  language: Lang;
  runDebug: Record<string, unknown> | null;
  allCandidates: CandidateSite[];
  onSelectSite: (id: string | null) => void;
}) {
  const [runOpen, setRunOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mt-6 space-y-3">
      {runDebug && (
        <div className="rounded-lg border border-line bg-bg-800/40 p-2.5">
          <button
            type="button"
            className="flex min-h-[36px] w-full items-center justify-between text-[12px] font-medium text-ink-200"
            onClick={() => setRunOpen((x) => !x)}
            aria-expanded={runOpen}
          >
            <span>{t(language, "runDebug")}</span>
            <span className="text-ink-400">{runOpen ? "▾" : "▸"}</span>
          </button>
          {runOpen && (
            <pre className="scroll-panel mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-900/70 p-2 text-[10.5px] leading-relaxed text-ink-300">
              {JSON.stringify(runDebug, null, 2)}
            </pre>
          )}
        </div>
      )}

      {allCandidates.length > 0 && (
        <div className="rounded-lg border border-line bg-bg-800/40 p-2.5">
          <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-ink-200">
            <span>{t(language, "perSiteDebug")}</span>
            <span className="text-ink-400">{allCandidates.length}</span>
          </div>
          <ul className="space-y-1.5">
            {allCandidates.map((c) => {
              const open = expandedId === c.id;
              const dbg = c.gemini_debug_json ?? null;
              return (
                <li
                  key={c.id}
                  className="rounded-md border border-line/70 bg-bg-900/50"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : c.id)}
                    className="flex min-h-[40px] w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[12px]"
                    aria-expanded={open}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span
                        className={
                          "me-1 inline-block h-1.5 w-1.5 rounded-full " +
                          (c.passes_strict_filters
                            ? "bg-accent-solar"
                            : "bg-ink-500")
                        }
                      />
                      {c.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-400">
                      {(c.feasibility_score ?? c.overall_site_score).toFixed(0)}
                    </span>
                    <span className="shrink-0 text-ink-400">{open ? "▾" : "▸"}</span>
                  </button>
                  {open && (
                    <div className="border-t border-line/70 px-2.5 pb-2.5 pt-2">
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        <MiniFlag
                          label="grounding"
                          on={
                            (dbg as Record<string, unknown> | null)
                              ?.grounding_used === true
                          }
                          attempted={
                            (dbg as Record<string, unknown> | null)
                              ?.attempted_grounding === true
                          }
                        />
                        <MiniFlag
                          label="maps"
                          on={
                            (dbg as Record<string, unknown> | null)
                              ?.maps_context_used === true
                          }
                          attempted={
                            (dbg as Record<string, unknown> | null)
                              ?.attempted_maps_context === true
                          }
                        />
                        <button
                          type="button"
                          onClick={() => onSelectSite(c.id)}
                          className="ms-auto rounded-full border border-line bg-bg-800/60 px-2 py-0.5 text-[10.5px] text-ink-200"
                        >
                          open →
                        </button>
                      </div>
                      <pre className="scroll-panel max-h-[36vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-900/70 p-2 text-[10.5px] leading-relaxed text-ink-300">
                        {dbg
                          ? JSON.stringify(dbg, null, 2)
                          : "(no debug payload)"}
                      </pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function MiniFlag({
  label,
  on,
  attempted,
}: {
  label: string;
  on: boolean;
  attempted: boolean;
}) {
  const cls = on
    ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
    : attempted
    ? "border-line bg-bg-800/60 text-ink-300"
    : "border-line bg-bg-800/30 text-ink-500";
  const state = on ? "used" : attempted ? "attempted" : "off";
  return (
    <span
      className={
        "rounded-full border px-2 py-0.5 text-[10px] font-medium " + cls
      }
    >
      {label}: {state}
    </span>
  );
}

/* ------------------------------ System Status ----------------------------- */

interface HealthResponse {
  ok: boolean;
  env: {
    gemini: { configured: boolean; masked: string | null };
    nrel: { configured: boolean; masked: string | null };
    maptiler: { configured: boolean; masked: string | null };
    mapbox: { configured: boolean; masked: string | null };
    googleSolar: { configured: boolean; masked: string | null };
    database: { configured: boolean };
  };
  database: {
    connected: boolean;
    latency_ms: number;
    schema_ready: boolean;
    states_rows: number;
    sites_rows: number;
    error: string | null;
  };
  enrichers: Record<string, { reachable: boolean; latency_ms: number; error?: string }>;
}

function SystemStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setHealth(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load_failed");
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const overall: "green" | "amber" | "red" = useMemo(() => {
    if (!health) return "amber";
    const envOk = health.env.gemini.configured && health.env.database.configured;
    const dbOk = !health.env.database.configured || health.database.connected;
    const probes = Object.values(health.enrichers);
    const reachable = probes.filter((p) => p.reachable).length;
    const ratio = probes.length > 0 ? reachable / probes.length : 1;
    if (dbOk && envOk && ratio >= 0.75) return "green";
    if (!dbOk || ratio < 0.4) return "red";
    return "amber";
  }, [health]);

  const dot =
    overall === "green"
      ? "bg-emerald-400"
      : overall === "red"
      ? "bg-red-500"
      : "bg-amber-400";

  return (
    <div className="mt-6 rounded-lg border border-line bg-bg-800/40 p-2.5">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="flex min-h-[36px] w-full items-center justify-between text-[12px] font-medium text-ink-200"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className={"inline-block h-2 w-2 rounded-full " + dot} />
          <span>System status</span>
        </span>
        <span className="text-ink-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-[11.5px]">
          {error && <div className="text-red-300">{error}</div>}
          {health && (
            <>
              <StatusRow
                label="Gemini"
                ok={health.env.gemini.configured}
                detail={health.env.gemini.masked ?? undefined}
              />
              <StatusRow
                label="NREL"
                ok={health.env.nrel.configured}
                detail={health.env.nrel.masked ?? undefined}
              />
              <StatusRow
                label="MapTiler"
                ok={health.env.maptiler.configured}
                detail={health.env.maptiler.masked ?? undefined}
              />
              <StatusRow
                label="Mapbox"
                ok={health.env.mapbox.configured}
                detail={health.env.mapbox.masked ?? undefined}
              />
              <StatusRow
                label="Google Solar"
                ok={health.env.googleSolar.configured}
                detail={health.env.googleSolar.masked ?? undefined}
              />
              <StatusRow
                label="PostgreSQL"
                ok={health.database.connected}
                detail={
                  health.env.database.configured
                    ? health.database.connected
                      ? `${health.database.latency_ms}ms · ${health.database.states_rows}s/${health.database.sites_rows}`
                      : health.database.error ?? "disconnected"
                    : "not configured"
                }
              />
              <div className="mt-2 border-t border-line/70 pt-1.5 text-[10.5px] uppercase tracking-[0.14em] text-ink-400">
                Enrichers
              </div>
              {Object.entries(health.enrichers).map(([name, p]) => (
                <StatusRow
                  key={name}
                  label={name}
                  ok={p.reachable}
                  detail={p.reachable ? `${p.latency_ms}ms` : p.error ?? "unreachable"}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-ink-200">
        <span
          className={
            "inline-block h-1.5 w-1.5 rounded-full " +
            (ok ? "bg-emerald-400" : "bg-red-500")
          }
          aria-hidden
        />
        <span className="font-mono">{label}</span>
      </span>
      <span
        className="truncate font-mono text-[10.5px] text-ink-400"
        title={detail ?? ""}
      >
        {ok ? "✔" : "✖"} {detail ?? ""}
      </span>
    </div>
  );
}
