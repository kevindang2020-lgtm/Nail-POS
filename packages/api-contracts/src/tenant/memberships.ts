// memberships.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface MemberExportRow { customerName: string; planName: string | null; status: string; memberNumber: string | null; joinDate: string | null; nextBillingAt: string | null; autoRenew: boolean; lifetimePaidCents: number }
export interface PaymentExportRow { customerName: string; planName: string | null; kind: string; amountCents: number; taxCents: number; status: string; processor: string | null; createdAt: string | null; settledAt: string | null }
export interface RedemptionExportRow { customerName: string; serviceName: string | null; standardValueCents: number; allocatedValueCents: number; upgradeChargeCents: number; technicianName: string | null; createdAt: string | null }
/** D6 Membership §16 (Nov 4 2026): what a PENDING membership still owes and how it can be paid. */
export interface MembershipFirstPaymentState { membershipId: string; status: string; awaitingFirstPayment: boolean; amountDueCents: number; cardOnFile: boolean; cardBillingConfigured: boolean; invoices: Array<{ id: string; number: string; totalCents: number; paidAt: string | null }> }
export interface MembershipFirstPaymentResult { membershipId: string; status: 'active'; paymentId: string | null; duplicate: boolean; amountCents: number; method: 'card_on_file' | 'invoice'; currentPeriodEnd: string | null }

// ── extras Membership Overview 13 · 10 "Smart subscription change preview" (POST pos/memberships/plans/:planId/versions/preview)
export type PlanVersionField = 'priceCents' | 'billingInterval' | 'intervalCount' | 'trialDays' | 'enrollmentFeeCents' | 'setupFeeCents' | 'autoRenew' | 'cancellationPolicy'
  | 'techSplitPct' | 'ownerSplitPct' | 'allocationTiming' | 'creditExpiryDays' | 'rolloverAllowed' | 'minCommitmentCycles' | 'benefits';
export interface PlanVersionSubscribers { versionNumber: number; priceCents: number; billingInterval: string; members: number; current: boolean }
export interface PlanVersionChangePreview {
  planId: string;
  /** plan_archived: publishing would be refused; no_change: the proposal equals the current version */
  blockers: ('plan_archived' | 'no_change')[];
  currentVersionNumber: number | null;
  nextVersionNumber: number;
  changes: { field: PlanVersionField; from: string | number | boolean | null; to: string | number | boolean | null }[];
  benefits: { current: number; proposed: number; carriedForward: boolean };
  /** live members (active / trial / grace / past due / paused) by the version they joined — they keep their own terms */
  currentSubscribers: { total: number; byVersion: PlanVersionSubscribers[]; keepTheirTerms: true };
  /** what people who join after publishing get */
  futureSubscribers: { priceCents: number; billingInterval: string; priceDeltaCents: number | null };
  readOnly: true;
}
