// growthLabels.ts — display labels for the codes the AI, communications, deals and community screens show (English +
// Vietnamese POS mandate, WP-C3; §120 AI reason / status codes). The code stays the value; only the label is translated,
// at render time. Lookup: `growth.code.<code>` (the code as sent, lower case, upper case), then the canonical status
// domains (ns/status) the caller names, then the humanised code — never blank, never a raw key.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { humanizeCode, statusLabelOrNull } from '../i18n/status-label';

export function growthCode(code: string | null | undefined, domains?: string | readonly string[]): string {
  if (code == null || code === '') return '';
  const c = String(code);
  for (const v of new Set([c, c.toLowerCase(), c.toUpperCase()])) {
    const key = `growth.code.${v}`;
    const s = t(key);
    if (s !== key) return s;
  }
  if (domains) { const d = statusLabelOrNull(domains, c); if (d) return d; }
  return humanizeCode(c);
}
