import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getLocale, setLocale as storeLocale, subscribe, t as translate, type Locale, type MessageKey } from './index';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  useEffect(() => subscribe(setLocaleState), []);

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale: storeLocale,
    t: (key, vars) => translate(key, vars),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used within LocaleProvider');
  return value;
}
