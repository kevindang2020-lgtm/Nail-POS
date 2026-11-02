// checkout-board-signals.vitest.spec — Checkout One-Screen + Payment Safety mandate (Oct 28 2026) §16, §33–§34, §53.
import { describe, it, expect } from 'vitest';
import { boardSignals, isUnknownTender, UNKNOWN_AFTER_MS, type BoardSignalsInput } from './checkout-board-signals';
import type { BranchUnsettledTender } from './unsettled-tenders';

const NOW = Date.parse('2026-10-28T16:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const guests: Record<string, string> = { t1: 'Ann Lee', t2: 'Bo Ng', t3: 'Cy Tran', t4: 'Di Vo', t5: 'Ed Ho' };
const base = (o: Partial<BoardSignalsInput> = {}): BoardSignalsInput => ({
  unpaid: [], unsettled: [], refunds: [], receiptOutcomes: [], paidTicketIdsToday: [],
  guestOf: (id) => (id && guests[id]) || 'Guest', hhmm: () => '10:00 AM', now: NOW, ...o,
});
const tender = (o: Partial<BranchUnsettledTender>): BranchUnsettledTender => ({ kind: 'payment', id: 'p1', ticketId: 't1', method: 'card', status: 'processing', amountCents: 5000, createdAt: ago(5_000), ...o });

describe('Pending Payments (§16) — the unsettled-payment guard sources, never declined payments', () => {
  it('counts every unresolved tender: POS card, split / Tap to Pay attempt, app charge', () => {
    const s = boardSignals(base({ unsettled: [tender({}), tender({ kind: 'attempt', id: 'a1', ticketId: 't2', status: 'authorization_pending', method: 'tap_to_pay' }), tender({ kind: 'app_intent', id: 'i1', ticketId: 't3' })] }));
    expect(s.pendingPayments).toBe(3);
  });
  it('nothing unresolved → 0 (declined payments are not "pending")', () => {
    expect(boardSignals(base({ unpaid: [{ ticketId: 't1', customerName: 'Ann Lee', status: 'failed' }] })).pendingPayments).toBe(0);
  });
});

describe('UNKNOWN is not declined (§31–§33)', () => {
  it('an attempt in an unknown / timed-out state is UNKNOWN at once; a fresh card is still "in progress"', () => {
    expect(isUnknownTender(tender({ kind: 'attempt', status: 'timed_out' }), NOW)).toBe(true);
    expect(isUnknownTender(tender({ kind: 'attempt', status: 'reconciliation_required' }), NOW)).toBe(true);
    expect(isUnknownTender(tender({ createdAt: ago(5_000) }), NOW)).toBe(false);
  });
  it('a card with no answer for 90 s becomes UNKNOWN — the operator is told not to charge again and to Verify', () => {
    const s = boardSignals(base({ unsettled: [tender({ createdAt: ago(UNKNOWN_AFTER_MS) })] }));
    expect(s.attention[0]).toMatchObject({ type: 'Payment Unknown', severity: 'danger', ticketId: 't1', guest: 'Ann Lee' });
    expect(s.attention[0].issue).toMatch(/do not charge again/i);
    expect(s.attention[0].issue).toMatch(/Verify Payment/);
    expect(s.attention[0].issue).not.toMatch(/declin|fail/i);
  });
  it('an in-flight card is listed as "Payment Processing" (warn), not hidden', () => {
    const s = boardSignals(base({ unsettled: [tender({})] }));
    expect(s.attention).toHaveLength(1);
    expect(s.attention[0]).toMatchObject({ type: 'Payment Processing', severity: 'warn' });
  });
});

describe('Transactions Needing Attention (§34) — every operational money question, most severe first', () => {
  it('UNKNOWN payment, uncertain refund, failed receipt and the ticket states all appear, danger first', () => {
    const s = boardSignals(base({
      unpaid: [{ ticketId: 't4', customerName: 'Di Vo', status: 'split', method: 'split' }, { ticketId: 't5', customerName: 'Ed Ho', status: 'failed' }],
      unsettled: [tender({ status: 'processing', createdAt: ago(120_000) })],
      refunds: [{ refundId: 'r1', paymentId: 'p9', ticketId: 't2', amountCents: 1000, status: 'processing', createdAt: ago(60_000), stranded: true }],
      receiptOutcomes: [{ ticketId: 't3', channel: 'sms', delivery: 'failed', at: ago(30_000) }],
      paidTicketIdsToday: ['t3'],
    }));
    const types = s.attention.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(['Payment Unknown', 'Refund Uncertain', 'Failed Receipt', 'Split Payment', 'Failed Payment']));
    const sev = s.attention.map((a) => a.severity);
    expect(sev.indexOf('warn')).toBeGreaterThan(sev.lastIndexOf('danger'));
    expect(sev.indexOf('info')).toBeGreaterThan(sev.lastIndexOf('warn'));
  });
  it('one row per ticket and kind (two unknown attempts on one ticket → one row)', () => {
    const s = boardSignals(base({ unsettled: [tender({ id: 'a', status: 'unknown', kind: 'attempt' }), tender({ id: 'b', status: 'timed_out', kind: 'attempt' })] }));
    expect(s.attention.filter((a) => a.type === 'Payment Unknown')).toHaveLength(1);
    expect(s.pendingPayments).toBe(2);   // but both still count as pending money questions
  });
  it('a refund still waiting (not stranded) is a warning, a stranded one is danger', () => {
    const r = (stranded: boolean) => boardSignals(base({ refunds: [{ refundId: 'r', paymentId: 'p', ticketId: 't1', amountCents: 1, status: 'processing', createdAt: ago(1), stranded }] })).attention[0].severity;
    expect(r(false)).toBe('warn'); expect(r(true)).toBe('danger');
  });
  it('the list is bounded (25) so a busy day never grows the page', () => {
    const many = Array.from({ length: 40 }, (_, k) => tender({ id: `p${k}`, ticketId: `x${k}`, status: 'unknown', kind: 'attempt' }));
    expect(boardSignals(base({ unsettled: many })).attention).toHaveLength(25);
  });
});

describe('Receipt Delivery Rate (§53) — real deliveries over paid tickets', () => {
  it('sent or saved = delivered; simulated / not configured / failed = not delivered', () => {
    const s = boardSignals(base({
      paidTicketIdsToday: ['t1', 't2', 't3', 't4'],
      receiptOutcomes: [
        { ticketId: 't1', channel: 'sms', delivery: 'sent', at: ago(1) },
        { ticketId: 't2', channel: 'app', delivery: 'saved', at: ago(1) },
        { ticketId: 't3', channel: 'sms', delivery: 'simulated', at: ago(1) },
        { ticketId: 't4', channel: 'email', delivery: 'not_configured', at: ago(1) },
      ],
    }));
    expect(s.receipt).toEqual({ percent: 50, delivered: 2, eligible: 4 });
    expect(s.attention).toHaveLength(0);   // simulated / not configured are setup facts, not failed deliveries
  });
  it('a failed SMS followed by a successful e-mail is delivered (no attention row)', () => {
    const s = boardSignals(base({ paidTicketIdsToday: ['t1'], receiptOutcomes: [{ ticketId: 't1', channel: 'sms', delivery: 'failed', at: ago(10) }, { ticketId: 't1', channel: 'email', delivery: 'sent', at: ago(1) }] }));
    expect(s.receipt.percent).toBe(100); expect(s.attention).toHaveLength(0);
  });
  it('receipt failure never reads as a payment problem (§53: the payment stands)', () => {
    const s = boardSignals(base({ paidTicketIdsToday: ['t1'], receiptOutcomes: [{ ticketId: 't1', channel: 'sms', delivery: 'blocked', at: ago(1) }] }));
    expect(s.attention[0]).toMatchObject({ type: 'Failed Receipt', severity: 'warn' });
    expect(s.attention[0].issue).toMatch(/payment stands/);
  });
  it('no paid ticket yet → null, not 0 %', () => {
    expect(boardSignals(base()).receipt).toEqual({ percent: null, delivered: 0, eligible: 0 });
  });
});

describe('staff panel is compact (§61): 200 technicians → 8 rows + counts for everyone', async () => {
  const { buildStaffRows, capStaffRows, STAFF_BOARD_LIMIT } = await import('./checkout.dto');
  it('caps rows, Ready first, and counts all', () => {
    const techs = Array.from({ length: 200 }, (_, i) => ({ id: 't' + i, name: 'Tech ' + i }));
    const statusBy: Record<string, string> = {}; techs.forEach((t, i) => { statusBy[t.id] = i % 4 === 0 ? 'available' : i % 4 === 1 ? 'busy' : i % 4 === 2 ? 'on_break' : 'off_shift'; });
    const r = capStaffRows(buildStaffRows(techs, statusBy));
    expect(STAFF_BOARD_LIMIT).toBe(8); expect(r.staff).toHaveLength(8); expect(r.staff.every((x) => x.status === 'Ready')).toBe(true);
    expect(r.staffSummary).toEqual({ total: 150, ready: 50, busy: 50, onBreak: 50, shown: 8 });
  });
});
