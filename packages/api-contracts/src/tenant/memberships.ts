// memberships.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface MemberExportRow { customerName: string; planName: string | null; status: string; memberNumber: string | null; joinDate: string | null; nextBillingAt: string | null; autoRenew: boolean; lifetimePaidCents: number }
export interface PaymentExportRow { customerName: string; planName: string | null; kind: string; amountCents: number; taxCents: number; status: string; processor: string | null; createdAt: string | null; settledAt: string | null }
export interface RedemptionExportRow { customerName: string; serviceName: string | null; standardValueCents: number; allocatedValueCents: number; upgradeChargeCents: number; technicianName: string | null; createdAt: string | null }
