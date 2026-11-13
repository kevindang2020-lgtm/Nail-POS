// coverage.ts — round 10 (English Vietnamese POS Localization 04) "Translation coverage": what the running POS actually has —
// every English key of the catalogues against its Vietnamese value. Read-only; computed from the same catalogues t() uses.
//   missingVi      English keys with no Vietnamese value (the screen falls back to English for these)
//   sameAsEnglish  Vietnamese value identical to the English one where the English has words (likely untranslated; brand
//                  names, codes, numbers and placeholders-only strings are not counted)
//   errorsMissing  the same, for error messages (keys of the errors namespace / error-text) — what a customer-facing refusal shows
// Hard-coded JSX text and the glossary are checked by the build gates (check-pos-i18n, check-vi-glossary); the Vietnamese drafts
// awaiting review are listed in docs/handoff/VI_DRAFT_REVIEW.md — the panel names both, it does not invent their numbers.
import { POS_EN } from './catalog.en';
import { POS_VI } from './catalog.vi';
import { NAMESPACES_EN, NAMESPACES_VI } from './ns';

export interface TranslationCoverageReport { total: number; translated: number; percent: number; missingVi: string[]; sameAsEnglish: string[]; errorsTotal: number; errorsMissing: string[] }

const KEEP_AS_IS = /^(AIPowerSalon|Fiserv|Clover|Tap to Pay|Twilio|Retell|Apple|Google|SMS|PIN|OTP|ID|URL|API|CSV|PDF|QR|HSN|MID|VIP|POS|USD|OK|AM|PM|—|\W+)$/i;
const hasWords = (s: string) => /[A-Za-z]{3,}/.test(s.replace(/\{[^}]*\}/g, ''));

export function translationCoverage(en: Record<string, string>[] = [POS_EN as Record<string, string>, ...(NAMESPACES_EN as Record<string, string>[])],
  vi: Record<string, string>[] = [POS_VI as Record<string, string>, ...(NAMESPACES_VI as Record<string, string>[])]): TranslationCoverageReport {
  const E: Record<string, string> = Object.assign({}, ...en); const V: Record<string, string> = Object.assign({}, ...vi);
  const keys = Object.keys(E).filter((k) => typeof E[k] === 'string' && E[k] !== '');
  const missingVi: string[] = []; const sameAsEnglish: string[] = [];
  for (const k of keys) {
    const v = V[k];
    if (typeof v !== 'string' || !v.trim()) missingVi.push(k);
    else if (v.trim() === E[k].trim() && hasWords(E[k]) && !KEEP_AS_IS.test(E[k].trim())) sameAsEnglish.push(k);
  }
  const isError = (k: string) => /^(errors?|err)\./.test(k) || /\.error\b|\.err\b/.test(k);
  const errorKeys = keys.filter(isError);
  const missing = new Set(missingVi);
  const translated = keys.length - missingVi.length;
  return { total: keys.length, translated, percent: keys.length ? Math.floor((translated / keys.length) * 1000) / 10 : 100,
    missingVi: missingVi.sort(), sameAsEnglish: sameAsEnglish.sort(), errorsTotal: errorKeys.length, errorsMissing: errorKeys.filter((k) => missing.has(k)).sort() };
}
