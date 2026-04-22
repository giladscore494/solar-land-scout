import en from "@/locales/en.json";
import he from "@/locales/he.json";
import type {
  CandidateSite,
  Language,
  LandCostBand,
  RecommendedLabel,
  StateMacro,
} from "@/types/domain";

const dictionaries = { en, he } as const;

export function isLanguage(value: string | null | undefined): value is Language {
  return value === "en" || value === "he";
}

export function normalizeLanguage(value: string | null | undefined): Language {
  return isLanguage(value) ? value : "en";
}

export function directionForLanguage(language: Language): "ltr" | "rtl" {
  return language === "he" ? "rtl" : "ltr";
}

export function t(language: Language, key: keyof typeof en, vars?: Record<string, string | number>) {
  let value = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
  if (!vars) return value;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

export function localizeStateName(
  state: Pick<StateMacro, "state_name_en" | "state_name_he">,
  language: Language
): string {
  return language === "he" ? state.state_name_he : state.state_name_en;
}

export function localizeStateSummary(
  state: Pick<StateMacro, "macro_summary_en" | "macro_summary_he">,
  language: Language
): string {
  return language === "he" ? state.macro_summary_he : state.macro_summary_en;
}

export function localizeCandidateReasons(
  site: Pick<CandidateSite, "qualification_reasons_en" | "qualification_reasons_he">,
  language: Language
): string[] {
  return language === "he" ? site.qualification_reasons_he : site.qualification_reasons_en;
}

export function localizeCandidateCautions(
  site: Pick<CandidateSite, "caution_notes_en" | "caution_notes_he">,
  language: Language
): string[] {
  return language === "he" ? site.caution_notes_he : site.caution_notes_en;
}

export function localizeCandidateSummary(
  site: Pick<CandidateSite, "gemini_summary_en" | "gemini_summary_he">,
  language: Language
): string {
  return language === "he" ? site.gemini_summary_he : site.gemini_summary_en;
}

export function localizeRecommendedLabel(label: RecommendedLabel, language: Language): string {
  return t(language, `tier.${label}` as keyof typeof en);
}

export function localizeLandCostBand(band: LandCostBand, language: Language): string {
  return t(language, `bands.${band}` as keyof typeof en);
}

export function localizeInfra(value: CandidateSite["distance_to_infra_estimate"], language: Language) {
  return t(language, `infra.${value}` as keyof typeof en);
}
