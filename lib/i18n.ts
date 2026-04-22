import en from "@/locales/en.json";
import he from "@/locales/he.json";

export type Lang = "en" | "he";
const dict = { en, he };

export function t(lang: Lang, key: keyof typeof en): string {
  return (dict[lang] as Record<string, string>)[key] ?? (dict.en as Record<string, string>)[key] ?? key;
}
