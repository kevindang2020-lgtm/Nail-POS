// i18n.ts — Constitution 6 §97–98 (BUILD_PLAN Phase 13, E; audit bug 11): the four mobile apps' translation layer.
//
// Tiny on purpose: `t('key', vars)` over flat catalogues, English + Vietnamese, English the default AND the fallback for
// every missing Vietnamese string (a half-translated screen shows English, never a key or a blank). Each app registers its
// own catalogues (apps/<app>/src/i18n/) on top of the shared one here; every English value is the exact string the screen
// showed before the key existed, so switching nothing changes nothing (the app tests assert today's English text).
//
// Language choice (§98): the USER's saved choice (server: {realm}/me/language, migration 560) > this device's last choice
// (localStorage, a convenience) > the device language (vi-* → Vietnamese) > English. Language only changes TEXT and the
// display locale; business dates use the BRANCH time zone and money the branch currency (formatters in @aipowersalon/
// money and @aipowersalon/date-time). Machine enums are never translated in data — only their labels (§97).
import { useSyncExternalStore } from 'react';
import { COMMON_EN, COMMON_VI } from './common';
import { APP_LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_LOCALE, isAppLanguage, type AppLanguage } from '@aipowersalon/api-contracts';

export type Catalog = Record<string, string>;
export const I18N_STORAGE_KEY = 'aps.language';

const catalogs: Record<AppLanguage, Catalog> = { en: {}, vi: {} };
let commonLoaded = false;

// ── POSLanguage.pdf §20 (Oct 28 2026): the application's language policy, applied at bootstrap ─────────────────────────────
// This module is shared by the Front Desk POS (English + Vietnamese) and the English-only apps (Customer, Technician, Owner,
// Tap to Pay). Each English-only app calls setLanguagePolicy(APPLICATION_LOCALE_POLICY.<APP>) FIRST (its src/language-
// policy.ts, the first import of main.tsx). From then on: no Vietnamese catalogue is mounted (registerCatalog('vi') is a
// no-op and anything already registered is dropped), setLanguage / initLanguage can never leave English, and neither the
// device language (vi-VN), a saved device choice nor a server answer can switch it. Hiding a toggle is not enough (§20).
let allowed: readonly AppLanguage[] = APP_LANGUAGES;
const permitted = (l: AppLanguage) => allowed.includes(l);
/** Restrict this application to `langs` (English is always kept). Call once at bootstrap, before any catalogue import. */
export function setLanguagePolicy(langs: readonly AppLanguage[]): void {
  const next = Array.from(new Set<AppLanguage>([DEFAULT_LANGUAGE, ...langs.filter(isAppLanguage)]));
  allowed = Object.freeze(next);
  for (const l of APP_LANGUAGES) if (!permitted(l)) catalogs[l] = {};
  if (!permitted(language)) { language = DEFAULT_LANGUAGE; emit(); }
}
/** The languages this application may show (tests, the coverage report). */
export function languagePolicy(): readonly AppLanguage[] { return allowed; }
/** The shared strings (sign-in, navigation, greetings) are registered lazily on first use so apps never forget them. */
function ensureCommon(): void {
  if (commonLoaded) return;
  commonLoaded = true;
  catalogs.en = { ...COMMON_EN, ...catalogs.en };
  if (permitted('vi')) catalogs.vi = { ...COMMON_VI, ...catalogs.vi };
}
let language: AppLanguage = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) { try { l(); } catch { /* a listener never breaks the switch */ } } };

/** Adds (or overrides) keys for a language. Apps call this once at import time. */
export function registerCatalog(lang: AppLanguage, entries: Catalog): void { ensureCommon(); if (!permitted(lang)) return; Object.assign(catalogs[lang], entries); }

// Missing-key warning (Vietnamese POS mandate §100, Oct 26 2026): in a DEV build a key with no text in any catalogue (the
// screen shows the raw key) or with no text in the current non-English language (the screen shows English) is reported
// ONCE per language+key on the console. Production stays silent and keeps the fallback. Additive: nothing else changes.
let warnOverride: boolean | undefined;
const warned = new Set<string>();
function warnEnabled(): boolean {
  if (warnOverride !== undefined) return warnOverride;
  try { const env = (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }).env; return env?.DEV === true && env?.MODE !== 'test'; } catch { return false; }
}
/** Tests: force the dev warning on (`true`), off (`false`), or back to the build default (`undefined`). */
export function setMissingKeyWarnings(on: boolean | undefined): void { warnOverride = on; warned.clear(); }
function warnMissing(key: string, inEnglish: boolean): void {
  const id = `${inEnglish ? '*' : language}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  try { console.warn(inEnglish ? `[i18n] missing key "${key}" (no text in any catalogue — the key is shown)` : `[i18n] missing ${language} text for "${key}" (English is shown)`); } catch { /* no console */ }
}

/** The text for `key` in the current language → the English text → the key. `{name}` placeholders are filled from vars. */
export function t(key: string, vars?: Record<string, string | number>): string {
  ensureCommon();
  const own = catalogs[language][key];
  if (own === undefined && warnEnabled()) warnMissing(key, catalogs.en[key] === undefined);
  const raw = own ?? catalogs.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

export function getLanguage(): AppLanguage { return language; }
/** An English plural ending (`n === 1 ? '' : 's'`) shown next to a translated word: kept in English, dropped in
 *  Vietnamese, which has no plural ending ("2 khách", never "2 kháchs"). */
export function enPlural(suffix: string): string { return language === 'en' ? suffix : ''; }
/** The display locale for numbers / dates in the current language ('en-US' | 'vi-VN'). */
export function currentLocale(): string { return LANGUAGE_LOCALE[language]; }

/** vi-* → 'vi'; anything else (or nothing) → English. */
export function detectLanguage(device?: string | null): AppLanguage {
  return typeof device === 'string' && /^vi\b/i.test(device.trim()) ? 'vi' : 'en';
}

function deviceLanguage(): string | undefined {
  try { return typeof navigator !== 'undefined' ? navigator.language : undefined; } catch { return undefined; }
}
function readLocal(): AppLanguage | null {
  try { const v = localStorage.getItem(I18N_STORAGE_KEY); return isAppLanguage(v) ? v : null; } catch { return null; }
}
function writeLocal(l: AppLanguage): void { try { localStorage.setItem(I18N_STORAGE_KEY, l); } catch { /* private mode */ } }

/**
 * Switch language. Re-renders every `useT()` screen. `persist` (the app's PUT {realm}/me/language) is awaited but a
 * failure never reverts the switch — the device keeps the choice and the next sign-in retries via initLanguage.
 */
export async function setLanguage(l: AppLanguage, o: { persist?: (l: AppLanguage) => Promise<unknown> } = {}): Promise<void> {
  if (!isAppLanguage(l) || !permitted(l)) return;   // §20: an English-only app never leaves English
  if (l !== language) { language = l; emit(); }
  writeLocal(l);
  if (o.persist) { try { await o.persist(l); } catch { /* offline: the device keeps it */ } }
}

/** At launch (and after sign-in, with `load`): pick the language by the order above and apply it. */
export async function initLanguage(o: { device?: string | null; load?: () => Promise<{ language: AppLanguage | null } | null | undefined> } = {}): Promise<AppLanguage> {
  let chosen: AppLanguage | null = null;
  if (allowed.length === 1) {   // §20: a one-language app ignores the server answer, the saved device choice and the device language
    if (language !== allowed[0]) { language = allowed[0]; emit(); }
    return language;
  }
  if (o.load) { try { const r = await o.load(); if (r && isAppLanguage(r.language)) chosen = r.language; } catch { /* offline / signed out */ } }
  if (!chosen) chosen = readLocal();
  if (!chosen) chosen = detectLanguage(o.device === undefined ? deviceLanguage() : o.device);
  if (!permitted(chosen)) chosen = DEFAULT_LANGUAGE;
  if (chosen !== language) { language = chosen; emit(); }
  if (o.load && chosen) writeLocal(chosen);
  return chosen;
}

function subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Non-React code (document `lang`, caches): called after every language change; returns the unsubscribe. */
export function onLanguageChange(fn: (l: AppLanguage) => void): () => void { return subscribe(() => fn(language)); }

/** React: the `t` function, re-rendering the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return t;
}
/** React: the current language (for a selector). */
export function useLanguage(): AppLanguage { return useSyncExternalStore(subscribe, getLanguage, getLanguage); }

/** Honest coverage numbers for the report: how many EN keys exist and how many have a VI translation. */
export function catalogCoverage(): { en: number; vi: number; missingVi: string[] } {
  ensureCommon();
  const en = Object.keys(catalogs.en);
  const missingVi = en.filter((k) => !(k in catalogs.vi));
  return { en: en.length, vi: en.length - missingVi.length, missingVi };
}
export function catalogFor(lang: AppLanguage): Readonly<Catalog> { return catalogs[lang]; }

export function resetI18nForTests(): void {
  allowed = APP_LANGUAGES;
  for (const l of APP_LANGUAGES) catalogs[l] = {};
  commonLoaded = true;   // tests start from an EMPTY catalogue (loadCommonForTests() re-adds the shared one)
  language = DEFAULT_LANGUAGE;
  emit();
}

export function loadCommonForTests(): void { commonLoaded = false; ensureCommon(); }
