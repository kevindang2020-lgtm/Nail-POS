// money-input.ts — the shared exact dollars→cents parser (mirror of packages/ui/src/money-input.ts, kept in
// sync by hand like the realtime cores; this app does not depend on @aipowersalon/ui).
// Pure STRING parsing: no parseFloat, no float money math. null on anything invalid.
export function parseDollarsToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/^\$/, '').trim();
  if (!/^\d*\.?\d{0,2}$/.test(s)) return null;
  const [intPart = '', decPart = ''] = s.split('.');
  if (intPart === '' && decPart === '') return null;           // "" or "."
  const dollars = intPart === '' ? 0 : parseInt(intPart, 10);
  const cents = decPart === '' ? 0 : parseInt(decPart.padEnd(2, '0'), 10);
  if (!Number.isFinite(dollars) || !Number.isFinite(cents)) return null;
  return dollars * 100 + cents;
}
