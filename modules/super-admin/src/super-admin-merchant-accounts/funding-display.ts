// funding-display.ts — the last four digits shown for a stored bank/routing number. Pure; sealing is the SECRET_SEALERS
// port ('funding').
export function last4(numeric: string | null | undefined): string | null {
  const d = (numeric || '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
}
