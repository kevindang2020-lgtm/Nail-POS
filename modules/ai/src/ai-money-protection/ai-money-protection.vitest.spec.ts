// ai-money-protection.vitest.spec.ts — deterministic rule engine + service (tenant isolation, idempotency).
import { describe, it, expect } from 'vitest';
import { detectDuplicateCharge, detectRefundExceedsCapture, runDeterministicRules, type NormalizedPayment, type NormalizedRefund } from './ai-money-protection-rules';
import { MoneyProtectionService, MoneyProtectionForbiddenError } from './ai-money-protection.service';
import { InMemoryMoneyProtectionRepository } from './ai-money-protection.repository';
import type { MoneyProtectionContext } from './ai-money-protection.dto';

const T = Date.parse('2026-07-07T10:00:00Z');
const pay = (o: Partial<NormalizedPayment>): NormalizedPayment => ({
  id: 'p', branchId: 'b1', ticketId: 't1', amountCents: 5000, method: 'card', status: 'approved',
  idempotencyKey: null, processorTxnId: null, createdByUserId: 'u1', createdAtMs: T, ...o,
});

describe('detectDuplicateCharge', () => {
  it('flags an EXACT duplicate sharing a processor transaction id (critical)', () => {
    const out = detectDuplicateCharge([pay({ id: 'p1', processorTxnId: 'TX9' }), pay({ id: 'p2', processorTxnId: 'TX9' })]);
    expect(out).toHaveLength(1);
    expect(out[0].alertType).toBe('duplicate_charge_exact');
    expect(out[0].severity).toBe('CRITICAL');
    expect(out[0].related.transactionIds).toEqual(['p1', 'p2']);
    expect(out[0].evidence.summary.toLowerCase()).not.toMatch(/fraud|theft|stole/); // non-accusatory
  });

  it('flags a LIKELY duplicate: same ticket/amount/method within the window', () => {
    const out = detectDuplicateCharge([pay({ id: 'p1', createdAtMs: T }), pay({ id: 'p2', createdAtMs: T + 30_000 })]);
    expect(out.some((a) => a.alertType === 'duplicate_charge_likely')).toBe(true);
  });

  it('does NOT flag a legitimate split payment (different methods)', () => {
    const out = detectDuplicateCharge([pay({ id: 'p1', method: 'card', amountCents: 3000 }), pay({ id: 'p2', method: 'cash', amountCents: 2000 })]);
    expect(out).toHaveLength(0);
  });

  it('ignores non-captured (failed/pending) payments', () => {
    const out = detectDuplicateCharge([pay({ id: 'p1', status: 'declined', processorTxnId: 'TX' }), pay({ id: 'p2', status: 'pending', processorTxnId: 'TX' })]);
    expect(out).toHaveLength(0);
  });
});

describe('detectRefundExceedsCapture', () => {
  it('flags when refunds exceed captured for a ticket', () => {
    const payments = [pay({ id: 'p1', ticketId: 't1', amountCents: 5000, status: 'approved' })];
    const refunds: NormalizedRefund[] = [{ id: 'r1', branchId: 'b1', ticketId: 't1', amountCents: 6000, status: 'refunded', createdAtMs: T }];
    const out = detectRefundExceedsCapture(payments, refunds);
    expect(out).toHaveLength(1);
    expect(out[0].alertType).toBe('refund_exceeds_capture');
    expect(out[0].amountCents).toBe(1000); // the over-amount under review
  });
  it('does not flag refunds within captured', () => {
    const payments = [pay({ id: 'p1', ticketId: 't1', amountCents: 5000 })];
    const refunds: NormalizedRefund[] = [{ id: 'r1', branchId: 'b1', ticketId: 't1', amountCents: 4000, status: 'refunded', createdAtMs: T }];
    expect(detectRefundExceedsCapture(payments, refunds)).toHaveLength(0);
  });
});

describe('MoneyProtectionService', () => {
  const ctx = (perms: string[]): MoneyProtectionContext => ({ tenantId: 'A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });

  it('requires permission for state', async () => {
    const svc = new MoneyProtectionService(new InMemoryMoneyProtectionRepository());
    await expect(svc.getState(ctx([]))).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
  });

  it('evaluates deterministically, creates alerts once (idempotent), and is tenant-scoped', async () => {
    const repo = new InMemoryMoneyProtectionRepository();
    repo.seedActivity('A', [pay({ id: 'p1', processorTxnId: 'TX9' }), pay({ id: 'p2', processorTxnId: 'TX9' })], []);
    const svc = new MoneyProtectionService(repo);
    const c = ctx(['ai_money_protection.view', 'ai_money_protection.view_alerts', 'ai_money_protection.manage_rules']);

    const first = await svc.evaluateDeterministic(c);
    expect(first.created).toBe(1);
    const second = await svc.evaluateDeterministic(c); // same window → dedup
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);

    const listA = await svc.listAlerts(c, {});
    expect(listA.items).toHaveLength(1);
    expect(listA.items[0].severity).toBe('CRITICAL');

    // tenant B sees nothing
    const listB = await svc.listAlerts({ ...c, tenantId: 'B' }, {});
    expect(listB.items).toHaveLength(0);

    const state = await svc.getState(c);
    expect(state.criticalAlerts).toBe(1);
    expect(state.valueUnderReviewCents).toBe(5000);
  });
});

import { detectRefundMethodMismatch, detectExcessiveDiscount, detectNonPositiveCapture, detectMultipleReversals, type NormalizedTicket } from './ai-money-protection-rules';

describe('slice-2 deterministic rules', () => {
  it('refund method mismatch: cash refund of a card-only ticket', () => {
    const payments = [pay({ id: 'p1', ticketId: 't1', method: 'card', status: 'approved' })];
    const refunds: NormalizedRefund[] = [{ id: 'r1', branchId: 'b1', ticketId: 't1', amountCents: 5000, method: 'cash', status: 'refunded', createdAtMs: T }];
    const out = detectRefundMethodMismatch(payments, refunds);
    expect(out).toHaveLength(1);
    expect(out[0].alertType).toBe('refund_method_mismatch');
  });
  it('refund method match: no alert when methods align', () => {
    const payments = [pay({ id: 'p1', ticketId: 't1', method: 'card', status: 'approved' })];
    const refunds: NormalizedRefund[] = [{ id: 'r1', branchId: 'b1', ticketId: 't1', amountCents: 5000, method: 'card', status: 'refunded', createdAtMs: T }];
    expect(detectRefundMethodMismatch(payments, refunds)).toHaveLength(0);
  });
  it('discount exceeds subtotal', () => {
    const tickets: NormalizedTicket[] = [{ id: 't1', branchId: 'b1', subtotalCents: 4000, discountCents: 5000, totalCents: 0, status: 'paid' }];
    const out = detectExcessiveDiscount(tickets);
    expect(out).toHaveLength(1);
    expect(out[0].amountCents).toBe(1000);
  });
  it('discount within subtotal: no alert', () => {
    expect(detectExcessiveDiscount([{ id: 't1', branchId: 'b1', subtotalCents: 5000, discountCents: 5000, totalCents: 0, status: 'paid' }])).toHaveLength(0);
  });
  it('negative captured amount flagged', () => {
    expect(detectNonPositiveCapture([pay({ id: 'p1', amountCents: -100, status: 'approved' })])).toHaveLength(1);
  });
  it('multiple reversals on one ticket', () => {
    const refunds: NormalizedRefund[] = [
      { id: 'r1', branchId: 'b1', ticketId: 't1', amountCents: 1000, status: 'refunded', createdAtMs: T },
      { id: 'r2', branchId: 'b1', ticketId: 't1', amountCents: 2000, status: 'refunded', createdAtMs: T + 1000 },
    ];
    const out = detectMultipleReversals(refunds);
    expect(out).toHaveLength(1);
    expect(out[0].amountCents).toBe(3000);
  });
  it('non-accusatory language across all slice-2 rules', () => {
    const tickets: NormalizedTicket[] = [{ id: 't1', branchId: 'b1', subtotalCents: 1, discountCents: 999, totalCents: 0, status: 'paid' }];
    for (const a of detectExcessiveDiscount(tickets)) expect(a.evidence.summary.toLowerCase()).not.toMatch(/fraud|theft|stole|guilty/);
  });
});

import { detectFailedPaymentRetryLoop, detectPaidTicketNoCapture, detectCaptureOnCancelledTicket, type NormalizedAttempt } from './ai-money-protection-rules';

describe('slice-3 reconciliation + retry-loop', () => {
  const att = (o: Partial<NormalizedAttempt>): NormalizedAttempt => ({ id: 'a', branchId: 'b1', ticketId: 't1', status: 'declined', method: 'card', createdAtMs: T, ...o });
  it('retry loop: 4+ declines on one ticket in window', () => {
    const attempts = [0, 60_000, 120_000, 180_000].map((d, i) => att({ id: 'a' + i, createdAtMs: T + d }));
    const out = detectFailedPaymentRetryLoop(attempts);
    expect(out).toHaveLength(1);
    expect(out[0].alertType).toBe('failed_payment_retry_loop');
  });
  it('retry loop: 3 declines does NOT flag (conservative)', () => {
    const attempts = [0, 60_000, 120_000].map((d, i) => att({ id: 'a' + i, createdAtMs: T + d }));
    expect(detectFailedPaymentRetryLoop(attempts)).toHaveLength(0);
  });
  it('approved attempts never count as declines', () => {
    const attempts = [0, 1, 2, 3].map((d, i) => att({ id: 'a' + i, status: 'approved', createdAtMs: T + d }));
    expect(detectFailedPaymentRetryLoop(attempts)).toHaveLength(0);
  });
  it('paid ticket with no capture flagged; comped $0 ticket not flagged', () => {
    const tickets: NormalizedTicket[] = [
      { id: 't1', branchId: 'b1', subtotalCents: 5000, discountCents: 0, totalCents: 5000, status: 'paid' },
      { id: 't2', branchId: 'b1', subtotalCents: 5000, discountCents: 5000, totalCents: 0, status: 'paid' }, // fully comped
    ];
    const out = detectPaidTicketNoCapture([], tickets);
    expect(out.map((a) => a.entityFingerprint)).toEqual(['paid_no_capture:t1']);
  });
  it('paid ticket WITH capture not flagged', () => {
    const tickets: NormalizedTicket[] = [{ id: 't1', branchId: 'b1', subtotalCents: 5000, discountCents: 0, totalCents: 5000, status: 'paid' }];
    expect(detectPaidTicketNoCapture([pay({ id: 'p1', ticketId: 't1', amountCents: 5000, status: 'approved' })], tickets)).toHaveLength(0);
  });
  it('captured money on a cancelled ticket flagged; net-zero after refund not flagged', () => {
    const tickets: NormalizedTicket[] = [
      { id: 't1', branchId: 'b1', subtotalCents: 5000, discountCents: 0, totalCents: 5000, status: 'cancelled' },
      { id: 't2', branchId: 'b1', subtotalCents: 5000, discountCents: 0, totalCents: 5000, status: 'voided' },
    ];
    const payments = [pay({ id: 'p1', ticketId: 't1', amountCents: 5000, status: 'approved' }), pay({ id: 'p2', ticketId: 't2', amountCents: 5000, status: 'approved' })];
    const refunds: NormalizedRefund[] = [{ id: 'r1', branchId: 'b1', ticketId: 't2', amountCents: 5000, status: 'refunded', createdAtMs: T }];
    const out = detectCaptureOnCancelledTicket(payments, refunds, tickets);
    expect(out.map((a) => a.related.ticketIds?.[0])).toEqual(['t1']); // t2 net-zero (refunded) excluded
  });
});
