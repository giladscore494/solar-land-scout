"use client";

import { RAMP_STOPS } from "@/lib/color-ramp";
import { t } from "@/lib/i18n";
import type { Language } from "@/types/domain";

export default function Legend({ language }: { language: Language }) {
  const gradient = `linear-gradient(to right, ${RAMP_STOPS.map((stop) => `${stop.color} ${stop.stop}%`).join(", ")})`;

  return (
    <div className="rounded-xl border border-line bg-bg-800/80 p-3 text-[11px] backdrop-blur-md shadow-panel">
      <div className="mb-1.5 flex items-center justify-between gap-6 text-ink-300">
        <span className="uppercase tracking-[0.14em]">{t(language, "state.macroScore")}</span>
        <span className="font-mono text-ink-400">0 – 100</span>
      </div>
      <div className="h-2 w-52 rounded-full ring-1 ring-line" style={{ background: gradient }} />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-400">
        <span>{t(language, "tier.Tier 4 — Marginal")}</span>
        <span>{t(language, "tier.Tier 3 — Moderate")}</span>
        <span>{t(language, "tier.Tier 1 — Strong")}</span>
      </div>
    </div>
  );
}
