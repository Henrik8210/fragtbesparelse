import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { da, en, type MessageKey } from "./i18n/messages.ts";
import { danishPhrase } from "./i18n/content.ts";

export type Lang = "da" | "en";

const dictionaries = { da, en };

type LanguageValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  adoptLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  phrase: (key: string, english: string) => string;
};

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("da");
  const adoptLang = useCallback((next: Lang) => setLangState(next), []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    void api("/api/me", { method: "PATCH", body: JSON.stringify({ lang: next }) }).catch(() => undefined);
  }, []);

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
    return { lang, setLang, adoptLang, t, phrase };
  }, [adoptLang, lang, setLang]);

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
