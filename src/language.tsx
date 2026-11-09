import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { da, en, type MessageKey } from "./i18n/messages.ts";
import { danishPhrase } from "./i18n/content.ts";

const STORAGE_KEY = "fairlane-language";

export type Lang = "da" | "en";

const dictionaries = { da, en };

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "da") return stored;
  } catch {
    // The default language still applies for this visit.
  }
  return "da";
}

function remember(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // The choice still applies for this visit.
  }
}

type LanguageValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  phrase: (key: string, english: string) => string;
};

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  function setLang(next: Lang) {
    setLangState(next);
    remember(next);
  }

  const value = useMemo<LanguageValue>(() => {
    function t(key: MessageKey, vars?: Record<string, string | number>): string {
      const template = dictionaries[lang][key] ?? dictionaries.en[key];
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
    }
    function phrase(key: string, english: string): string {
      if (lang === "en") return english;
      return danishPhrase(key) ?? english;
    }
    return { lang, setLang, t, phrase };
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", value.t("meta.description"));
  }, [lang, value]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider missing");
  return value;
}
