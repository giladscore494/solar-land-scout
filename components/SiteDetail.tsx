"use client";

import type { CandidateSite, EnrichmentProvenance } from "@/types/domain";
import { useExplain } from "./StateDetail";

export default function SiteDetail({
  site,
  onBack,
}: {
  site: CandidateSite;
  onBack: () => void;
}) {
  const { explain, loading, source } = useExplain("site", site.id);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-line/60 bg-bg-800/40 px-2.5 py-1 text-[12px] font-medium text-ink-200 transition hover:text-ink-50 active:scale-[0.98]"
      >
        ← back to {site.state_name}
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-400">
            {site.state_code} · candidate site
          </div>
          <div className="mt-0.5 text-[17px] font-semibold leading-tight">
            {site.title}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-400">
            {site.lat.toFixed(4)}, {site.lng.toFixed(4)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[22px] font-semibold text-accent-solar">
            {site.overall_site_score.toFixed(0)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">
            site score
          </div>
        </div>
      </div>

      {/* Hard-exclusion warnings (visible when strict_only is OFF) */}
      {site.in_protected_area === true && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          ⚠ Inside a USGS PAD-US protected area
          {site.protected_area_name ? ` — ${site.protected_area_name}` : ""}.
          Filtered out of strict results.
        </div>
      )}
      {site.in_flood_zone === true && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          ⚠ Inside FEMA high-risk flood zone
          {site.flood_zone ? ` ${site.flood_zone}` : ""}. Filtered out of strict results.
        </div>
      )}

      {/* Metric strip */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Solar (GHI)" value={`${site.solar_resource_value.toFixed(1)} kWh/m²/day`} />
        <Metric label="Slope" value={`${site.slope_estimate.toFixed(1)} %`} />
        <Metric label="Land cost" value={site.estimated_land_cost_band} />
        <Metric
          label="Infra proximity"
          value={
            typeof site.distance_to_infra_km === "number"
              ? `${site.distance_to_infra_estimate} · ${site.distance_to_infra_km.toFixed(1)} km`
              : site.distance_to_infra_estimate
          }
        />
        <Metric label="Open-land score" value={`${site.open_land_score} / 100`} />
        <Metric
          label="Strict v1"
          value={site.passes_strict_filters ? "passes" : "does not pass"}
          accent={site.passes_strict_filters}
        />
      </div>

      {/* Qualification reasons */}
      <Block title="Why it qualifies">
        <ul className="space-y-1.5">
          {site.qualification_reasons.map((r, i) => (
            <li
              key={i}
              className="flex gap-2 text-[12.5px] leading-relaxed text-ink-200"
            >
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-solar" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </Block>

      {/* Caution notes */}
      {site.caution_notes.length > 0 && (
        <Block title="Caution notes">
          <ul className="space-y-1.5">
            {site.caution_notes.map((r, i) => (
              <li
                key={i}
                className="flex gap-2 text-[12.5px] leading-relaxed text-ink-300"
              >
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-magenta" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Data sources — enrichment provenance */}
      {site.enrichment_provenance && site.enrichment_provenance.length > 0 && (
        <Block title="Data sources">
          <div className="flex flex-wrap gap-1.5">
            {site.enrichment_provenance.map((p, i) => (
              <ProvenancePill key={`${p.source}-${i}`} p={p} />
            ))}
          </div>
        </Block>
      )}

      {/* Google Solar Insights — only when available */}
      {site.google_solar?.available === true && (
        <Block title="Google Solar Insights">
          <div className="grid grid-cols-2 gap-2">
            {typeof site.google_solar.max_array_m2 === "number" && (
              <Metric
                label="Max array area"
                value={`${Math.round(site.google_solar.max_array_m2).toLocaleString()} m²`}
              />
            )}
            {typeof site.google_solar.sunshine_hours_yr === "number" && (
              <Metric
                label="Sunshine hours / yr"
                value={`${Math.round(site.google_solar.sunshine_hours_yr).toLocaleString()}`}
              />
            )}
            {typeof site.google_solar.carbon_offset_kg_per_mwh === "number" && (
              <Metric
                label="Carbon offset"
                value={`${site.google_solar.carbon_offset_kg_per_mwh.toFixed(0)} kg/MWh`}
              />
            )}
          </div>
        </Block>
      )}

      {/* LLM narrative */}
      <Block
        title="Analyst summary"
        right={
          loading ? (
            <span className="text-[10px] text-ink-400">generating…</span>
          ) : source === "gemini" ? (
            <span className="rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 text-[10px] font-medium text-accent-cyan">
              gemini
            </span>
          ) : (
            <span className="rounded-full border border-line bg-bg-700 px-2 py-0.5 text-[10px] font-medium text-ink-400">
              deterministic
            </span>
          )
        }
      >
        {loading && <p className="text-[12.5px] text-ink-300">Generating analyst summary…</p>}
        {!loading && explain && (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-100">
              {explain.summary}
            </p>
            {explain.risks.length > 0 && (
              <div className="mt-3">
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
      </Block>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-bg-800/60 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div
        className={
          "mt-0.5 text-[13px] font-medium " +
          (accent ? "text-accent-solar" : "text-ink-50")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Block({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 rounded-lg border border-line bg-bg-800/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ProvenancePill({ p }: { p: EnrichmentProvenance }) {
  const label =
    {
      nasa_power: "NASA POWER",
      usgs_elevation: "USGS Elevation",
      osm_infra: "OSM Overpass",
      usgs_padus: "USGS PAD-US",
      fema_flood: "FEMA NFHL",
      google_solar: "Google Solar",
    }[p.source] ?? p.source;

  const icon =
    p.status === "ok"
      ? "✓"
      : p.status === "skipped"
      ? "·"
      : p.status === "timeout"
      ? "⧗"
      : "✕";

  const tone =
    p.status === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : p.status === "skipped"
      ? "border-line bg-bg-800/60 text-ink-400"
      : "border-amber-500/40 bg-amber-500/10 text-amber-200";

  const age = formatAge(p.at);

  return (
    <span
      title={`${p.source} · ${p.status}${p.note ? ` · ${p.note}` : ""} · ${p.latency_ms}ms`}
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium " +
        tone
      }
    >
      <span>{label}</span>
      <span className="opacity-80">{icon}</span>
      <span className="opacity-70">{age}</span>
    </span>
  );
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
