// membership-compensation-core.ts — pure mapping from an immutable membership redemption to a technician compensation
// entry. The 60/40 split was FROZEN onto the redemption's commission_basis_snapshot at redemption time (Phase 5a); this
// file does NOT recompute it — it reads the frozen techCents and shapes a compensation entry. Membership-covered work
// thus pays the technician their booked share, separate from tips (100% theirs) and tax. Integer cents.

export interface RedemptionForComp { redemptionId: string; serviceLineId: string | null; technicianId: string | null; commissionBasisSnapshot: string | null }
export interface MembershipCompEntry { technicianId: string; serviceLineId: string | null; amountCents: number; reason: string; redemptionId: string }

// Stable reason prefix — used to detect already-booked lines so re-running booking is idempotent.
export const MEMBERSHIP_COMP_REASON_PREFIX = 'Membership service commission';

/** Read the frozen split from a redemption's commission_basis_snapshot JSON. Returns null on missing/garbage. */
export function parseSnapshot(snapshot: string | null): { techCents: number; ownerCents: number; eligibleCents: number; basis: string } | null {
  if (!snapshot) return null;
  try {
    const o = JSON.parse(snapshot) as Record<string, unknown>;
    const num = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
    return { techCents: num(o.techCents), ownerCents: num(o.ownerCents), eligibleCents: num(o.eligibleCents), basis: String(o.basis ?? 'allocated') };
  } catch { return null; }
}

/** Map a redemption to a positive comp entry crediting the technician their frozen share. Returns null (skip) when there
 * is no technician or no booked tech earnings (e.g., allocation deferred or zero-value benefit). */
export function redemptionToCompEntry(r: RedemptionForComp): MembershipCompEntry | null {
  if (!r.technicianId) return null;
  const snap = parseSnapshot(r.commissionBasisSnapshot);
  if (!snap || snap.techCents <= 0) return null;
  return { technicianId: r.technicianId, serviceLineId: r.serviceLineId, amountCents: snap.techCents, reason: `${MEMBERSHIP_COMP_REASON_PREFIX} · ${snap.basis} basis`, redemptionId: r.redemptionId };
}
