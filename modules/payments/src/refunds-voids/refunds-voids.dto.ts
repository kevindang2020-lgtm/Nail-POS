// refunds-voids.dto.ts — money-reversal visibility for the Payments area. Reads reversal payment rows
// (refunded/voided) and rolls them up. Money = integer cents. Reuses the shared REFUND_STATUSES source.
import { REFUND_STATUSES } from '@aipowersalon/api-contracts';

export interface RefundsVoidsContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export type ReversalKind = 'refund' | 'void';

export interface ReversalRow {
  id: string;
  kind: ReversalKind;
  status: string;
  method: string;
  amountCents: number;
  ticketId: string | null;
  ticketNumber: string | null;
  processedByName: string | null;
  createdAt: string;
}

export interface RefundsVoidsSummary {
  refundCount: number;
  refundedCents: number;
  voidCount: number;
  voidedCents: number;
  totalReversalCount: number;
  totalReversalCents: number;
}

export interface RefundsVoidsState { kpis: RefundsVoidsSummary; rows: ReversalRow[]; }

const VOID_STATUSES = new Set(['voided', 'void']);
export function classifyReversal(status: string): ReversalKind {
  return VOID_STATUSES.has((status || '').toLowerCase()) ? 'void' : 'refund';
}
export function isReversalStatus(status: string): boolean {
  return (REFUND_STATUSES as readonly string[]).includes((status || '').toLowerCase());
}

// Pure rollup — split refunds vs voids and total. No DB, unit-testable.
export function buildRefundsVoidsSummary(rows: ReversalRow[]): RefundsVoidsSummary {
  let refundCount = 0, refundedCents = 0, voidCount = 0, voidedCents = 0;
  for (const r of rows) {
    const amt = Math.max(0, Math.round(r.amountCents || 0));
    if (r.kind === 'void') { voidCount++; voidedCents += amt; }
    else { refundCount++; refundedCents += amt; }
  }
  return {
    refundCount, refundedCents, voidCount, voidedCents,
    totalReversalCount: refundCount + voidCount,
    totalReversalCents: refundedCents + voidedCents,
  };
}
