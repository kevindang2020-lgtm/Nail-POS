// expense-money.ts — exact money rules for an expense (mandate §14, §33–34, §68–69, §200). Integer cents only.
//
// The breakdown must add up: subtotal + tax + tip + fees − discount = total, within a small rounding tolerance, and only
// over the parts that are present. An AI total that does not reconcile is never accepted as fact — the expense is
// flagged for review instead (§33). Branch allocations sum EXACTLY to the total (§69).

export interface Breakdown { subtotalCents?: number | null; taxCents?: number | null; tipCents?: number | null; feeCents?: number | null; discountCents?: number | null; totalCents: number }
export interface ReconcileResult { reconciles: boolean; checked: boolean; expectedCents: number | null; differenceCents: number }

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Parse money a person typed ("12.5", "$1,234.56") into integer cents, or null — never a float in storage. */
export function parseCents(input: string | number | null | undefined): number | null {
  if (input == null || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  const s = String(input).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [d, f = ''] = s.split('.');
  return Number(d) * 100 + Number((f + '00').slice(0, 2));
}

/** §34 / §200: check the arithmetic over the parts that exist. With no subtotal there is nothing to check. */
export function reconcileBreakdown(b: Breakdown, toleranceCents = 2): ReconcileResult {
  if (!isCents(b.totalCents)) return { reconciles: false, checked: true, expectedCents: null, differenceCents: 0 };
  if (!isCents(b.subtotalCents)) return { reconciles: true, checked: false, expectedCents: null, differenceCents: 0 };
  const parts = [b.taxCents, b.tipCents, b.feeCents].filter(isCents).reduce((s, x) => s + x, 0);
  const expected = b.subtotalCents + parts - (isCents(b.discountCents) ? b.discountCents : 0);
  const diff = b.totalCents - expected;
  return { reconciles: Math.abs(diff) <= toleranceCents, checked: true, expectedCents: expected, differenceCents: diff };
}

/** Half-up rounding of a cents value computed from a rate (e.g. tax 6.625% of $100.00 = 662.5 → 663). */
export function roundHalfUp(cents: number): number { return Math.sign(cents) * Math.round(Math.abs(cents) + Number.EPSILON); }

export interface AllocationInput { branchId: string; amountCents?: number | null; basisPoints?: number | null }
export interface Allocation { branchId: string; amountCents: number; basisPoints: number | null }

/**
 * §68–69: split one expense across branches. Either explicit amounts that already sum to the total, or basis points
 * (100% = 10 000) that sum to 10 000 — converted with the largest-remainder method so the cents sum EXACTLY to the
 * total (no penny lost to rounding). Anything else is refused with a reason.
 */
export function allocate(totalCents: number, input: readonly AllocationInput[]): { ok: true; allocations: Allocation[] } | { ok: false; error: string } {
  if (!isCents(totalCents)) return { ok: false, error: 'total must be integer cents' };
  if (!input.length) return { ok: false, error: 'no allocations' };
  const seen = new Set<string>();
  for (const a of input) { if (!a.branchId) return { ok: false, error: 'each allocation needs a branch' }; if (seen.has(a.branchId)) return { ok: false, error: 'a branch appears twice' }; seen.add(a.branchId); }
  const byAmount = input.every((a) => a.amountCents != null);
  if (byAmount) {
    if (!input.every((a) => isCents(a.amountCents))) return { ok: false, error: 'amounts must be integer cents' };
    const sum = input.reduce((s, a) => s + (a.amountCents as number), 0);
    if (sum !== totalCents) return { ok: false, error: `allocations sum to ${sum}, the expense is ${totalCents}` };
    return { ok: true, allocations: input.map((a) => ({ branchId: a.branchId, amountCents: a.amountCents as number, basisPoints: totalCents ? Math.round(((a.amountCents as number) * 10000) / totalCents) : null })) };
  }
  if (!input.every((a) => a.basisPoints != null && Number.isInteger(a.basisPoints) && (a.basisPoints as number) >= 0)) return { ok: false, error: 'give every branch an amount or a percentage' };
  const bp = input.reduce((s, a) => s + (a.basisPoints as number), 0);
  if (bp !== 10000) return { ok: false, error: `percentages sum to ${bp / 100}%, not 100%` };
  const raw = input.map((a) => ({ a, exact: (totalCents * (a.basisPoints as number)) / 10000 }));
  const floors = raw.map((r) => Math.floor(r.exact));
  let left = totalCents - floors.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, frac: r.exact - floors[i] })).sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (const o of order) { if (left <= 0) break; floors[o.i] += 1; left -= 1; }
  return { ok: true, allocations: raw.map((r, i) => ({ branchId: r.a.branchId, amountCents: floors[i], basisPoints: r.a.basisPoints as number })) };
}

/** §65 (Oct 27 2026): an expense split by hand whose TOTAL is edited afterwards keeps the owner's proportions — each
 *  branch's new amount is its old amount scaled to the new total (largest remainder, so the split still sums to the new
 *  total exactly). Before, the old amounts stayed and no longer added up to the expense. Pure. */
export function rescaleAllocations(existing: readonly { branchId: string; amountCents: number }[], newTotalCents: number): { ok: true; allocations: Allocation[] } | { ok: false; error: string } {
  if (!isCents(newTotalCents)) return { ok: false, error: 'total must be integer cents' };
  if (!existing.length) return { ok: false, error: 'no allocations' };
  const oldTotal = existing.reduce((t, a) => t + a.amountCents, 0);
  if (oldTotal <= 0) return { ok: false, error: 'the old split carries nothing to scale — split the expense again' };
  const raw = existing.map((a) => (newTotalCents * a.amountCents) / oldTotal);
  const floors = raw.map((x) => Math.floor(x));
  let left = newTotalCents - floors.reduce((t, x) => t + x, 0);
  const order = raw.map((x, i) => ({ i, frac: x - floors[i] })).sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (const o of order) { if (left <= 0) break; floors[o.i] += 1; left -= 1; }
  return { ok: true, allocations: existing.map((a, i) => ({ branchId: a.branchId, amountCents: floors[i], basisPoints: newTotalCents ? Math.round((floors[i] * 10000) / newTotalCents) : null })) };
}

export type SharedCostPolicy = 'NONE' | 'MANUAL_PERCENTAGE';
export interface SharedCostShare { branchId: string; basisPoints: number }

/** P2-3 (Oct 23 2026): a policy's shares are valid when every branch appears once with whole basis points and they
 *  total exactly 100% (10 000) — "50 / 30 / 20" is valid, "50 / 30 / 10" is refused with the actual sum. */
export function validSharedCostShares(shares: readonly SharedCostShare[]): { ok: true } | { ok: false; error: string } {
  if (!shares.length) return { ok: false, error: 'give each branch its share (they must total 100%)' };
  const r = allocate(10000, shares.map((x) => ({ branchId: x.branchId, basisPoints: x.basisPoints })));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * P2-3: one branch's share of the salon-wide expenses in a window, computed — never copied into new expense rows.
 *  • an expense with its own split (expense_allocations) uses that split for this branch;
 *  • otherwise, policy MANUAL_PERCENTAGE splits it by the owner's shares (largest remainder: the branches' shares of
 *    one expense sum exactly to it);
 *  • otherwise (policy NONE, or a branch with no share) the branch carries nothing of it.
 */
export function branchShareOfSalonWide(
  expenses: readonly { id: string; amountCents: number }[],
  ownSplits: ReadonlyMap<string, readonly { branchId: string; amountCents: number }[]>,
  policy: SharedCostPolicy, shares: readonly SharedCostShare[], branchId: string,
): { allocatedCents: number; expenseCount: number; byOwnSplitCents: number; byPolicyCents: number } {
  let byOwn = 0, byPolicy = 0, count = 0;
  for (const e of expenses) {
    const own = ownSplits.get(e.id);
    if (own && own.length) { const mine = own.find((a) => a.branchId === branchId)?.amountCents ?? 0; if (mine) { byOwn += mine; count++; } continue; }
    if (policy !== 'MANUAL_PERCENTAGE' || !shares.length) continue;
    const r = allocate(e.amountCents, shares.map((x) => ({ branchId: x.branchId, basisPoints: x.basisPoints })));
    if (!r.ok) continue;   // a stored policy that no longer sums to 100% shares nothing (the settings save refuses one)
    const mine = r.allocations.find((a) => a.branchId === branchId)?.amountCents ?? 0;
    if (mine) { byPolicy += mine; count++; }
  }
  return { allocatedCents: byOwn + byPolicy, expenseCount: count, byOwnSplitCents: byOwn, byPolicyCents: byPolicy };
}

/** A bill's state from what has been paid against it (§55); the due window is computed, never stored. */
export function billStatusFor(totalCents: number, paidCents: number, voided = false): 'open' | 'partially_paid' | 'paid' | 'voided' {
  if (voided) return 'voided';
  if (paidCents <= 0) return 'open';
  return paidCents >= totalCents ? 'paid' : 'partially_paid';
}
export function billDueState(dueDate: string | null, today: string, billStatus: string, reminderDays = 7): 'paid' | 'overdue' | 'due_today' | 'due_soon' | 'scheduled' | 'no_due_date' | 'voided' {
  if (billStatus === 'paid') return 'paid';
  if (billStatus === 'voided') return 'voided';
  if (!dueDate) return 'no_due_date';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'due_today';
  const days = Math.round((Date.parse(dueDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  return days <= reminderDays ? 'due_soon' : 'scheduled';
}
