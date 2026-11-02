// checkout-discount-items.ts — BUILD_PLAN Phase 5, bug 14: what the screens and the receipt show for a ticket's discounts,
// read from its pricing snapshot (the one engine's output): the real coupon (or none), and every discount itemized.
/** The coupon on a ticket (from its pricing snapshot), or null — never a made-up "DISCOUNT" code. */
export function couponOf(snapshot: any): { code: string; amountCents: number } | null {
  const c = (snapshot?.applied ?? []).find((a: any) => a.category === 'coupon');
  return c ? { code: String(c.description ?? 'Coupon').replace(/^Coupon:\s*/, ''), amountCents: Number(c.appliedCents) || 0 } : null;
}
/** Every discount on the ticket, itemized for the screen and the receipt (category, label, amount, deal). */
export function itemizedDiscounts(snapshot: any, totalCents: number): { category: string; label: string; amountCents: number; dealId: string | null; redemptionId: string | null }[] {
  const applied: any[] = Array.isArray(snapshot?.applied) ? snapshot.applied : [];
  if (!applied.length) return totalCents > 0 ? [{ category: 'manual', label: 'Discount', amountCents: totalCents, dealId: null, redemptionId: null }] : [];
  return applied.filter((a) => Number(a.appliedCents) > 0).map((a) => ({ category: String(a.category), label: String(a.description || a.category), amountCents: Number(a.appliedCents) || 0, dealId: a.dealId ?? null, redemptionId: a.redemptionId ?? null }));
}


/**
 * BUILD_PLAN Phase 5 — the itemized receipt: each service at its price, the discounts taken off it (from the pricing
 * snapshot's per-line allocation), and what the customer saved. Plain text (email body; the SMS carries the savings line).
 */
export function itemizedReceipt(t: { lines?: { serviceLineId: string; serviceName: string; priceCents: number }[]; discountSnapshot?: any }, money: (c: number) => string): { text: string; savedCents: number; savingsLine: string } {
  const snap = t.discountSnapshot ?? null;
  const applied: any[] = Array.isArray(snap?.applied) ? snap.applied : [];
  const out: string[] = [];
  for (const l of t.lines ?? []) {
    out.push(`${l.serviceName}  ${money(l.priceCents)}`);
    for (const a of applied) {
      const share = (a.lines ?? []).find((x: any) => x.lineId === l.serviceLineId);
      if (share && share.cents > 0) out.push(`   ${a.description || a.category}  -${money(share.cents)}`);
    }
  }
  // discounts recorded without a per-line split (older snapshots, flat amounts)
  for (const a of applied) if (!(a.lines ?? []).length && Number(a.appliedCents) > 0) out.push(`${a.description || a.category}  -${money(Number(a.appliedCents))}`);
  const saved = applied.reduce((n, a) => n + (Number(a.appliedCents) || 0), 0);
  const savingsLine = saved > 0 ? `You saved ${money(saved)}.` : '';
  if (savingsLine) out.push(savingsLine);
  return { text: out.join('\n'), savedCents: saved, savingsLine };
}
