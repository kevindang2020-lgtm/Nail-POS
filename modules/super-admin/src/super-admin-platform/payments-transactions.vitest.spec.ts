import { describe, it, expect, vi } from 'vitest';
import { SuperAdminPlatformService } from './super-admin-platform.service';

// Service contract for the Payments & Transactions aggregate: raw repo rows are shaped through payments-core so status,
// masked card, totals, refund + settlement labels, and masked contact details are all derived consistently. The hard
// rule: no PAN is ever emitted — only "Brand •••• last4". KPIs pass real values through and gap the unsourced honestly.
function harness(over: any = {}) {
  const raw = {
    total: 2,
    rows: [
      { id: 'p1', tenantId: 't1', tenantName: 'Luxe Salon & Spa', branch: 'Main', merchantId: 'LUXE-002-999888', customerId: 'c1', customerName: 'Michael Thompson', customerEmail: 'michael.t@example.com', customerPhone: '+1 (555) 345-6789', amountCents: 15600, tipCents: 2000, taxCents: 1180, discountCents: 0, surchargeCents: 352, method: 'card', cardBrand: 'Mastercard', cardLast4: '5588', status: 'completed', approved: true, failed: false, processor: 'fiserv', reference: 'TKN-8A42-19', refundedCents: 0, createdAt: '2026-05-06T14:15:00Z' },
      { id: 'p2', tenantId: 't2', tenantName: 'Elite Cuts', branch: 'Uptown', merchantId: null, customerId: 'c2', customerName: 'Ava Miller', customerEmail: null, customerPhone: null, amountCents: 9000, tipCents: 0, taxCents: 0, discountCents: 0, surchargeCents: 0, method: 'card', cardBrand: 'Visa', cardLast4: '9999999999999876', status: 'declined', approved: false, failed: true, processor: 'cardpointe', reference: null, refundedCents: 9000, createdAt: '2026-05-06T13:00:00Z' },
    ],
    kpiRaw: { total: 24812, approved: 22631, failed: 1248, volumeCents: 41276842, processingFeesCents: 1284700, settledCount: 21987, refundVoidCount: 812, duplicateAlerts: 36 },
    byMethod: [{ method: 'card', count: 10, cents: 5000 }], trend: [{ day: '2026-05-06', cents: 5000 }],
    failed: [{ id: 'p2', amountCents: 9000, reason: 'declined', createdAt: '2026-05-06T13:00:00Z' }], processors: [{ processor: 'fiserv', lastSyncAt: '2026-05-06T14:20:00Z', events: 5 }],
    ...over,
  };
  const repo = { paymentsTransactions: vi.fn(async () => raw), paymentTransactionDetail: vi.fn(async () => raw.rows[0]) };

  const events = [
    { event_type: 'payment_succeeded', processor_type: 'fiserv', processor_transaction_id: 'PX1', event_id: 'evt_1', signature_valid: true, processed_at: '2026-05-06T14:15:01Z', created_at: '2026-05-06T14:15:00Z' },
    { event_type: 'settlement_failed', processor_type: 'fiserv', processor_transaction_id: 'PX1', event_id: 'evt_2', signature_valid: false, processed_at: null, created_at: '2026-05-06T15:00:00Z' },
  ];
  repo.paymentAuthorizationHistory = vi.fn(async (id: string) => id === 'p1' ? { events } : null);
  return { svc: new SuperAdminPlatformService(repo as any), repo };
}

describe('SuperAdminPlatformService.paymentsTransactions', () => {
  it('shapes rows with masked card, status, totals, refund + settlement labels, masked contact', async () => {
    const { svc } = harness();
    const out = await svc.paymentsTransactions({});
    const r1 = out.rows[0];
    expect(r1.card).toBe('Mastercard •••• 5588');
    expect(r1.statusLabel).toBe('Approved'); expect(r1.statusTone).toBe('ok');
    expect(r1.totalChargedCents).toBe(15600 + 2000 + 1180 + 352); // 19132
    expect(r1.refundStatus).toBe('No Refund'); expect(r1.settlementStatus).toBe('Unsettled');
    expect(r1.customerEmail).toBe('m•••@example.com'); expect(r1.customerPhone).toBe('•••• 89');
    expect(r1.merchant).not.toBeNull(); // masked MID, not raw
    expect(r1.merchant).not.toContain('999888');
  });

  it('never emits a PAN and marks failed/full-refund correctly', async () => {
    const { svc } = harness();
    const out = await svc.paymentsTransactions({});
    const r2 = out.rows[1];
    expect(r2.card).toBe('Visa •••• 9876'); // only last 4, even though a long value was present
    expect(r2.card).not.toMatch(/\d{5,}/);
    expect(r2.statusLabel).toBe('Declined'); expect(r2.statusTone).toBe('danger');
    expect(r2.refundStatus).toBe('Fully Refunded');
  });

  it('assembles the 8 KPIs from real values', async () => {
    const { svc } = harness();
    const { kpis } = await svc.paymentsTransactions({});
    expect(kpis.totalTransactions).toEqual({ value: 24812, available: true });
    expect(kpis.grossVolumeCents).toEqual({ value: 41276842, available: true });
    expect(kpis.duplicateAlerts).toEqual({ value: 36, available: true });
    expect(kpis.processingFeesCents.value).toBe(1284700);
  });

  it('detail masks contact + card and reports honest gaps for auth code + device', async () => {
    const { svc } = harness();
    const d = await svc.paymentTransactionDetail('p1');
    expect(d!.card).toBe('Mastercard •••• 5588');
    expect(d!.email).toBe('m•••@example.com');
    expect(d!.authorizationCode).toBeNull(); // no source column
    expect(d!.deviceUsed).toBeNull();
    expect(d!.totalChargedCents).toBe(19132);
  });
});

describe('SuperAdminPlatformService.paymentAuthorizationHistory (§22)', () => {
  it('maps the safe gateway-event log to labelled, read-only rows with signature + processed flags', async () => {
    const { svc } = harness();
    const h = await svc.paymentAuthorizationHistory('p1');
    expect(h!.events).toHaveLength(2);
    expect(h!.events[0]).toMatchObject({ label: 'Authorization approved', tone: 'ok', processor: 'fiserv', correlationId: 'evt_1', signatureValid: true, processed: true });
    expect(h!.events[1]).toMatchObject({ label: 'Settlement failed', tone: 'danger', signatureValid: false, processed: false });
    // no payload/secret fields leak through
    expect(JSON.stringify(h)).not.toMatch(/payload|secret|pan|cvv/i);
  });
  it('returns null for an unknown transaction (→ 404)', async () => {
    const { svc } = harness();
    expect(await svc.paymentAuthorizationHistory('ghost')).toBeNull();
  });
});
