// error-message.ts — Vietnamese POS §2 / §21 / §58 (V-5, Oct 27 2026): the Owner App, Tech App (and any app that registers an
// `errors.<CODE>` catalogue) word a failed API call in the user's language, like the POS does (apps/pos-web i18n/error-text).
//   • English     → the server's own sentence (often more specific than the registry's generic one).
//   • Vietnamese  → errors.<messageCode> (the code the server attached with withCode — details.messageCode), else
//                   errors.<code>, filled from the answer's primitive details; the server's English only for a code the
//                   app has no text for. Never a raw key, never blank.
// The thrown error keeps `code` (screens branch on it) — only the message is localized.
import { catalogFor, getLanguage } from './i18n';

function innerDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const d = (details ?? {}) as Record<string, unknown>;
  const env = d.error && typeof d.error === 'object' ? (d.error as Record<string, unknown>).details : undefined;
  const own = d.details;
  const pick = env && typeof env === 'object' ? env : own && typeof own === 'object' ? own : d;
  return pick as Record<string, unknown>;
}

export function localizedErrorMessage(code: string | null | undefined, details: Record<string, unknown> | null | undefined, serverMessage: string): string {
  const lang = getLanguage();
  if (lang === 'en') return serverMessage;
  const inner = innerDetails(details);
  const cat = catalogFor(lang);
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(inner)) if (typeof v === 'string' || typeof v === 'number') vars[k] = v;
  for (const c of [typeof inner.messageCode === 'string' ? inner.messageCode : null, code]) {
    const raw = c ? cat[`errors.${c}`] : undefined;
    if (raw) return raw.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  }
  return serverMessage;
}
