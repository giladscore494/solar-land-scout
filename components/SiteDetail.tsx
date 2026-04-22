"use client";

import type { CandidateSite, Language } from "@/types/domain";
import { localizeCandidateCautions, localizeCandidateReasons, localizeInfra, localizeLandCostBand, localizeStateName, t } from "@/lib/i18n";
import { useExplain } from "./StateDetail";

export default function SiteDetail({
  site,
  language,
  onBack,
}: {
  site: CandidateSite;
  language: Language;
  onBack: () => void;
}) {
  const { explain, loading, source } = useExplain("site", site.id, language);
  const localizedStateName = localizeStateName(site, language);
  const reasons = localizeCandidateReasons(site, language);
  const cautions = localizeCandidateCautions(site, language);

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-[11.5px] font-medium text-ink-300 transition hover:text-ink-50">
        {t(language, "site.back", { state: localizedStateName })}
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-400">
            {site.state_code} · {t(language, "site.candidate")}
          </div>
          <div className="mt-0.5 text-[17px] font-semibold leading-tight">{site.title}</div>
          <div className="mt-1 font-mono text-[11px] text-ink-400">
            {site.lat.toFixed(4)}, {site.lng.toFixed(4)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[22px] font-semibold text-accent-solar">{site.overall_site_score.toFixed(0)}</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">{t(language, "site.score")}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label={t(language, "site.solar")} value={`${site.solar_resource_value.toFixed(1)} kWh/m²/day`} />
        <Metric label={t(language, "site.slope")} value={`${site.slope_estimate.toFixed(1)} %`} />
        <Metric label={t(language, "site.landCost")} value={localizeLandCostBand(site.estimated_land_cost_band, language)} />
        <Metric label={t(language, "site.infra")} value={localizeInfra(site.distance_to_infra_estimate, language)} />
        <Metric label={t(language, "site.openLand")} value={`${site.open_land_score} / 100`} />
        <Metric
          label={t(language, "site.strict")}
          value={site.passes_strict_filters ? t(language, "site.passes") : t(language, "site.fails")}
          accent={site.passes_strict_filters}
        />
      </div>

      <Block title={t(language, "site.qualifies")}> 
        <ul className="space-y-1.5">
          {reasons.map((reason, index) => (
            <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-200">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-solar" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </Block>

      {cautions.length > 0 && (
        <Block title={t(language, "site.cautions")}>
          <ul className="space-y-1.5">
            {cautions.map((note, index) => (
              <li key={index} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-300">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent-magenta" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block
        title={t(language, "site.summary")}
        right={
          loading ? (
            <span className="text-[10px] text-ink-400">…</span>
          ) : source === "gemini" ? (
            <span className="rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 text-[10px] font-medium text-accent-cyan">
              {t(language, "source.gemini")}
            </span>
          ) : (
            <span className="rounded-full border border-line bg-bg-700 px-2 py-0.5 text-[10px] font-medium text-ink-400">
              {t(language, "source.deterministic")}
            </span>
          )
        }
      >
        {loading && <p className="text-[12.5px] text-ink-300">{t(language, "site.generating")}</p>}
        {!loading && explain && (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-100">{explain.summary}</p>
            {explain.risks.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.18em] text-ink-400">{t(language, "state.verify")}</div>
                <ul className="space-y-1">
                  {explain.risks.map((risk, index) => (
                    <li key={index} className="flex gap-2 text-[12px] leading-relaxed text-ink-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
                      <span>{risk}</span>
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

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-bg-800/60 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`mt-0.5 text-[13px] font-medium ${accent ? "text-accent-solar" : "text-ink-50"}`}>{value}</div>
    </div>
  );
}

function Block({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-lg border border-line bg-bg-800/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}
