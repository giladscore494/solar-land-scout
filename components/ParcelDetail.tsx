"use client";

import type { CandidateSite } from "@/types/domain";

interface ParcelDetailProps {
  parcel: CandidateSite;
  onBack: () => void;
}

export default function ParcelDetail({ parcel, onBack }: ParcelDetailProps) {
  const score = parcel.overall_site_score;
  const scoreColor =
    score >= 75 ? "text-green-400" : score >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-line/60 bg-bg-800/40 px-2.5 py-1 text-[12px] font-medium text-ink-200 transition hover:text-ink-50 active:scale-[0.98]"
      >
        ← back
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-400">
            {parcel.state_code} · parcel candidate
          </div>
          <div className="mt-0.5 text-[17px] font-semibold leading-tight">{parcel.title}</div>
          <div className="mt-1 font-mono text-[11px] text-ink-400">
            {parcel.lat.toFixed(4)}, {parcel.lng.toFixed(4)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`font-mono text-[22px] font-semibold ${scoreColor}`}>
            {score.toFixed(0)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">score</div>
        </div>
      </div>

      {/* Exclusion warnings */}
      {parcel.in_protected_area === true && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          ⚠ Inside a protected area
          {parcel.protected_area_name ? ` — ${parcel.protected_area_name}` : ""}.
        </div>
      )}
      {parcel.in_flood_zone === true && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          ⚠ Inside FEMA high-risk flood zone
          {parcel.flood_zone ? ` ${parcel.flood_zone}` : ""}.
        </div>
      )}

      {/* Key metrics */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Solar GHI" value={`${parcel.annual_ghi_kwh_m2?.toFixed(1) ?? "—"} kWh/m²`} />
        <Metric label="Site Score" value={`${score.toFixed(0)} / 100`} />
        <Metric
          label="Land Cost Band"
          value={parcel.estimated_land_cost_band ?? "—"}
        />
        <Metric
          label="Grid Proximity"
          value={parcel.distance_to_infra_estimate ?? "—"}
        />
        {parcel.slope_pct != null && (
          <Metric label="Slope" value={`${parcel.slope_pct.toFixed(1)}%`} />
        )}
        {parcel.contiguous_acres != null && (
          <Metric label="Area" value={`${parcel.contiguous_acres.toFixed(0)} ac`} />
        )}
      </div>

      {/* Qualification reasons */}
      {parcel.qualification_reasons.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Why it passed
          </div>
          <ul className="space-y-1">
            {parcel.qualification_reasons.map((r, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-ink-200">
                <span className="mt-0.5 shrink-0 text-green-400">✓</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Caution notes */}
      {parcel.caution_notes.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Cautions
          </div>
          <ul className="space-y-1">
            {parcel.caution_notes.map((r, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-ink-300">
                <span className="mt-0.5 shrink-0 text-amber-400">⚠</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line/40 bg-bg-800/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] text-ink-100">{value}</div>
    </div>
  );
}
