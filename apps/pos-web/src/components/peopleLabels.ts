// peopleLabels.ts — display labels for the people-screen codes the API sends (customer status / group, import action,
// membership status) — English + Vietnamese POS mandate, WP-C2. The code stays the value (filters, comparisons, colours);
// only the label is translated, at render time. A code the catalogue does not know shows humanised, never a raw key.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { humanizeCode } from '../i18n/status-label';

/** the catalogue text of `key` (built by the caller as `people.<area>.${code}` so the key gate sees the prefix), else the
 *  humanised code */
export function codeLabel(key: string, code: string | null | undefined): string {
  if (code == null || code === '') return '';
  const s = t(key);
  return s === key ? humanizeCode(String(code)) : s;
}
export const customerStatusLabel = (code: string | null | undefined) => codeLabel(`people.customer.status.${code}`, code);
export const customerSegmentLabel = (code: string | null | undefined) => codeLabel(`people.customer.segment.${code}`, code);
export const membershipStatusLabel = (code: string | null | undefined) => codeLabel(`people.membership.status.${code}`, code);
