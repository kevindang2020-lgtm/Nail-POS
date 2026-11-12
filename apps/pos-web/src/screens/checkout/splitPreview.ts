// Split Tender Preview (Extras backlog · Split Payments 09): before Take Payment, the intended allocation by tender
// (card / cash / gift card), what is still due or over, and which amounts are not valid money. Pure and read-only —
// nothing is charged, held or recorded until the cashier takes the payment (the server re-checks the same total).
import { parseDollarsToCents } from '@aipowersalon/money';

export type SplitSeg = { method: string; amountStr: string };
export type SplitPreview = { byMethod: { method: string; cents: number; count: number }[]; totalCents: number; remainingCents: number; invalid: number; ok: boolean };

export function splitPreview(segments: SplitSeg[], dueCents: number): SplitPreview {
  const by = new Map<string, { cents: number; count: number }>(); let invalid = 0; let total = 0;
  for (const s of segments) {
    const c = parseDollarsToCents(s.amountStr);
    if (c == null || c <= 0) { invalid += 1; continue; }
    const cur = by.get(s.method) ?? { cents: 0, count: 0 }; cur.cents += c; cur.count += 1; by.set(s.method, cur); total += c;
  }
  const order = ['card', 'cash', 'gift_card'];
  const byMethod = [...by.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => order.indexOf(a.method) - order.indexOf(b.method));
  return { byMethod, totalCents: total, remainingCents: dueCents - total, invalid, ok: invalid === 0 && segments.length > 0 && total === dueCents };
}
