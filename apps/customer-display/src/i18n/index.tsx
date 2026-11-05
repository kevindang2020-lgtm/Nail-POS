// i18n — Dual-Screen mandate §118–§119: the customer display speaks the languages the salon turned on (Owner Settings →
// Available Languages; the server sends them with the display's state, the first is the salon's default). A guest may
// switch for their own visit; the next guest starts in the salon's default again. Components ask useT() for words.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DISPLAY_LANGUAGES, LANGUAGE_NAMES, LOCALES, translate, type DisplayLanguage, type MsgKey } from './messages';

export { translate, type MsgKey, type DisplayLanguage } from './messages';

export interface LanguageState {
  lang: DisplayLanguage;
  available: DisplayLanguage[];
  setLang: (l: DisplayLanguage) => void;
}
const Ctx = createContext<LanguageState>({ lang: 'en', available: ['en'], setLang: () => undefined });

/** The server's list, cleaned: known languages only, no repeats, never empty (English when nothing usable came). */
export function availableLanguages(fromServer: readonly string[] | undefined | null): DisplayLanguage[] {
  const out = (fromServer ?? []).filter((l): l is DisplayLanguage => (DISPLAY_LANGUAGES as readonly string[]).includes(l));
  const uniq = [...new Set(out)];
  return uniq.length ? uniq : ['en'];
}

export function LanguageProvider({ value, children }: { value: LanguageState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type T = ((key: MsgKey, vars?: Record<string, string | number>) => string) & { lang: DisplayLanguage; locale: string };
/** The translator for the guest's language (English outside a provider — tests, the pairing screen). */
export function useT(): T {
  const { lang } = useContext(Ctx);
  return useMemo(() => Object.assign((key: MsgKey, vars?: Record<string, string | number>) => translate(lang, key, vars), { lang, locale: LOCALES[lang] }), [lang]);
}
export function useLanguage(): LanguageState { return useContext(Ctx); }

/** A message with one <b>…</b> span (e.g. "You’re <b>#3</b> in line"), rendered without HTML injection. */
export function Rich({ text }: { text: string }) {
  const m = /^(.*?)<b>(.*?)<\/b>(.*)$/s.exec(text);
  if (!m) return <>{text}</>;
  return <>{m[1]}<b>{m[2]}</b>{m[3]}</>;
}

/** The guest's language switch — only when the salon offers more than one. Each language is named in itself. */
export function LanguageSwitch({ className = 'lang-switch' }: { className?: string }) {
  const { lang, available, setLang } = useLanguage();
  const t = useT();
  if (available.length < 2) return null;
  return (
    <div className={className} role="group" aria-label={t('lang.label')}>
      {available.map((l) => (
        <button key={l} type="button" lang={l} className={`lang-opt${l === lang ? ' on' : ''}`} aria-pressed={l === lang} onClick={() => setLang(l)}>{LANGUAGE_NAMES[l]}</button>
      ))}
    </div>
  );
}
