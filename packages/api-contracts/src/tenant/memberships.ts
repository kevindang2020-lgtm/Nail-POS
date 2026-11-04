// memberships.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface MemberExportRow { customerName: string; planName: string | null; status: string; memberNumber: string | null; joinDate: string | null; nextBillingAt: string | null; autoRenew: boolean; lifetimePaidCents: number }
export interface PaymentExportRow { customerName: string; planName: string | null; kind: string; amountCents: number; taxCents: number; status: string; processor: string | null; createdAt: string | null; settledAt: string | null }
export interface RedemptionExportRow { customerName: string; serviceName: string | null; standardValueCents: number; allocatedValueCents: number; upgradeChargeCents: number; technicianName: string | null; createdAt: string | null }
/** D6 Membership §16 (Nov 4 2026): what a PENDING membership still owes and how it can be paid. */
export interface MembershipFirstPaymentState { membershipId: string; status: string; awaitingFirstPayment: boolean; amountDueCents: number; cardOnFile: boolean; cardBillingConfigured: boolean; invoices: Array<{ id: string; number: string; totalCents: number; paidAt: string | null }> }
export interface MembershipFirstPaymentResult { membershipId: string; status: 'active'; paymentId: string | null; duplicate: boolean; amountCents: number; method: 'card_on_file' | 'invoice'; currentPeriodEnd: string | null }
