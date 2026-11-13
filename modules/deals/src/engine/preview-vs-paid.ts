// preview-vs-paid.ts — Extras · Deals & Offers 08 "Preview vs Paid Comparison: compare the initial estimate with the final
// Checkout discount and explain changes due to ticket edits". Pure, integer cents.
//
// The initial estimate is the discount the engine priced when the deal / coupon went on the ticket, kept in
// deal_redemptions.estimate_snapshot (migration 871, written once). The paid figure is the application's amount when the
// ticket was paid (amount_discounted_cents — re-priced while the ticket was open; refunds after payment are shown apart as
// reversed). The explanation compares the ticket's lines then and now: removed / added lines and price changes, each with
// the discount it carried; when the lines are the same but the amount moved, the other offers on the ticket, a cap or the
// budget decided it (the stacking engine), and the explainer says that — it never invents a cause or a figure.
export interface EstimateSnapshot { discountCents: number; allocations: { lineId: string; cents: number }[]; lines: { lineId: string; priceCents: number }[] }
export type PreviewChangeCode = 'line_removed' | 'line_added' | 'price_changed' | 'other_offers_or_limits';
export interface PreviewChange { code: PreviewChangeCode; lineId: string | null; beforeCents: number | null; afterCents: number | null; discountBeforeCents: number | null; discountAfterCents: number | null }
export interface PreviewVsPaid { estimateCents: number; paidCents: number; changeCents: number; unchanged: boolean; changes: PreviewChange[] }

const int = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

/** Parse a stored snapshot; anything malformed is "not recorded" (null), never a guessed estimate. */
export function readEstimateSnapshot(v: unknown): EstimateSnapshot | null {
  const o = v;   // a JSONB column arrives parsed
  if (!o || typeof o !== 'object' || !('discountCents' in o)) return null;
  const r = o as Record<string, unknown>;
  return { discountCents: Math.max(0, int(r.discountCents)),
    allocations: list(r.allocations).map((a) => ({ lineId: String(a.lineId), cents: Math.max(0, int(a.cents)) })),
    lines: list(r.lines).map((l) => ({ lineId: String(l.lineId), priceCents: Math.max(0, int(l.priceCents)) })) };
}

export function comparePreviewToPaid(snapshot: EstimateSnapshot | null, paid: { discountCents: number; allocations: { lineId: string; cents: number }[]; lines: { lineId: string; priceCents: number }[] }): PreviewVsPaid | null {
  if (!snapshot) return null;
  const before = new Map(snapshot.lines.map((l) => [l.lineId, l.priceCents]));
  const after = new Map(paid.lines.map((l) => [l.lineId, l.priceCents]));
  const dBefore = new Map(snapshot.allocations.map((a) => [a.lineId, a.cents]));
  const dAfter = new Map(paid.allocations.map((a) => [a.lineId, a.cents]));
  const changes: PreviewChange[] = [];
  for (const [id, p] of before) {
    if (!after.has(id)) changes.push({ code: 'line_removed', lineId: id, beforeCents: p, afterCents: null, discountBeforeCents: dBefore.get(id) ?? 0, discountAfterCents: null });
    else if (after.get(id) !== p) changes.push({ code: 'price_changed', lineId: id, beforeCents: p, afterCents: after.get(id)!, discountBeforeCents: dBefore.get(id) ?? 0, discountAfterCents: dAfter.get(id) ?? 0 });
  }
  for (const [id, p] of after) if (!before.has(id)) changes.push({ code: 'line_added', lineId: id, beforeCents: null, afterCents: p, discountBeforeCents: null, discountAfterCents: dAfter.get(id) ?? 0 });
  const estimateCents = snapshot.discountCents, paidCents = Math.max(0, int(paid.discountCents));
  const changeCents = paidCents - estimateCents;
  // the lines explain the movement only as far as their own discount moved; the rest is the stacking engine's decision
  const explained = changes.reduce((n, c) => n + ((c.discountAfterCents ?? 0) - (c.discountBeforeCents ?? 0)), 0);
  if (changeCents !== explained) changes.push({ code: 'other_offers_or_limits', lineId: null, beforeCents: null, afterCents: null, discountBeforeCents: null, discountAfterCents: changeCents - explained });
  return { estimateCents, paidCents, changeCents, unchanged: changeCents === 0 && changes.length === 0, changes };
}
