import { useState, useEffect, useCallback } from "react";
import { getLanguage, setLanguage as setStoredLanguage, t, getSupportedLanguages, type SupportedLanguage } from "@/lib/i18n";

export function useLanguage() {
  const [language, setLanguageState] = useState<SupportedLanguage>(getLanguage);
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const handleLanguageChange = (event: CustomEvent<SupportedLanguage>) => {
      setLanguageState(event.detail);
      forceUpdate({});
    };

    window.addEventListener("languageChange", handleLanguageChange as EventListener);
    return () => {
      window.removeEventListener("languageChange", handleLanguageChange as EventListener);
    };
  }, []);

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setStoredLanguage(lang);
    setLanguageState(lang);
  }, []);

  const translate = useCallback((key: string): string => {
    return t(key);
  }, [language]);

  return {
    language,
    setLanguage,
    t: translate,
    supportedLanguages: getSupportedLanguages(),
  };
}
