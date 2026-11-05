// format.ts — pure display helpers. Money is integer cents everywhere; format only at the edge.
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const dollars = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${negative ? '-' : ''}$${dollars}`;
}

// "—" when missing, else last-4 as •••• 1234
export function maskedPhone(last4?: string | null): string {
  return last4 ? `•••• ${last4}` : '—';
}

// A friendly status label for queue/ticket statuses.
export function titleCase(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Client-side tip preview. Mirrors the backend tipForPercent (round(subtotal * pct / 100)); the server remains the
// source of truth when the attempt is created.
export function computeTipCents(subtotalCents: number, percent: number): number {
  return Math.round((subtotalCents * percent) / 100);
}
