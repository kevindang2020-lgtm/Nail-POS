// customerLanguage.ts — the customer's message language (WP-I: `customers.preferred_language`, 'en' | 'vi') as staff see it
// (Vietnamese POS mandate, WP-C2 follow-up). The stored value stays the code; the screen shows the language's own name —
// "English" / "Tiếng Việt" in both POS languages, the standard way a language picker is written.
export const CUSTOMER_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'vi', name: 'Tiếng Việt' },
] as const;

/** 'en' / 'en-US' → "English", 'vi' / 'vi-VN' → "Tiếng Việt"; anything else is shown as stored (never blank) */
export function customerLanguageName(code: string | null | undefined): string {
  const c = String(code ?? '').trim();
  const base = c.toLowerCase().split(/[-_]/)[0];
  return CUSTOMER_LANGUAGES.find((l) => l.code === base)?.name ?? c;
}

/** the picker value for a stored language: 'vi…' → 'vi', anything else that is set → 'en', unset → '' */
export function customerLanguageCode(code: string | null | undefined): '' | 'en' | 'vi' {
  const base = String(code ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return base === 'vi' ? 'vi' : base ? 'en' : '';
}
