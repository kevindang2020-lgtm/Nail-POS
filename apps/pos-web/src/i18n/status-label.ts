// status-label.ts — the display label for a canonical status / enum code (English + Vietnamese POS mandate §20, §21, §62;
// build plan WP-D1). The code stays the authority (stored, sent, compared, used for colour); only the label is translated.
//
//   statusLabel('appointment', 'in_service')          → "In Service" / "Đang phục vụ"
//   statusLabel(['payment', 'paymentAttempt'], code)   → the first domain that knows the code
//
// Lookup: `status.<domain>.<code>` in ns/status, then the same code in lower / upper case (the API is not consistent about
// case: READY_FOR_CHECKOUT vs ready_for_checkout). Contract: never blank for a non-empty code, never a raw key — a code the
// catalogue does not know yet shows the humanised code ("READY_FOR_CHECKOUT" → "Ready for checkout"). Translated at
// render time (call it in render, never at import), so a language switch re-labels in place.
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function humanizeCode(code: string): string {
  const s = String(code ?? '').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** the catalogue label for a code, or null when no domain knows it */
export function statusLabelOrNull(domain: string | readonly string[], code: string | null | undefined): string | null {
  if (code == null || code === '') return null;
  const c = String(code);
  const domains = typeof domain === 'string' ? [domain] : domain;
  const variants = [...new Set([c, c.toLowerCase(), c.toUpperCase()])];
  for (const d of domains) {
    for (const v of variants) {
      const key = `status.${d}.${v}`;
      const text = t(key);
      if (text !== key) return text;
    }
  }
  return null;
}

export function statusLabel(domain: string | readonly string[], code: string | null | undefined): string {
  if (code == null || code === '') return '';
  return statusLabelOrNull(domain, code) ?? humanizeCode(String(code));
}

/** a list of codes, each labelled ("low_stock, damaged" → "Low Stock, Damaged") */
export function statusLabels(domain: string | readonly string[], codes: readonly (string | null | undefined)[] | null | undefined, sep = ', '): string {
  return (codes ?? []).filter((c): c is string => !!c).map((c) => statusLabel(domain, c)).join(sep);
}
