// server-text.ts — Oct 21 2026 (POS Vietnamese): a few labels come from the API in English ("All Systems Operational").
// When such a label is EXACTLY a text the POS already knows, show that text's translation; anything else (a name, a
// free-form reason, a message the POS has never seen) is shown as sent. Never guesses, never half-translates.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { POS_EN } from './catalog.en';

let byText: Map<string, string> | null = null;
export function serverText(s: string | null | undefined): string {
  if (!s) return s ?? '';
  if (!byText) { byText = new Map(); for (const [k, v] of Object.entries(POS_EN)) if (!byText.has(v)) byText.set(v, k); }
  const key = byText.get(s.trim());
  return key ? t(key) : s;
}
