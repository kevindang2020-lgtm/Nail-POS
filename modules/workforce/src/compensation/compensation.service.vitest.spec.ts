// compensation.service.vitest.spec.ts — orchestrator: maps real service-line rows → engine → snapshot+tips, with fake
// ports (no DB). Proves discount allocation, retail separation, reconciliation, idempotent persistence, and the safety
// property that snapshotPaidTicket NEVER throws (a snapshot failure can't break a captured payment).
import { describe, it, expect } from 'vitest';
import { CompensationService, engineInputFromLines, type ServiceLineRow, type CompensationPorts } from './compensation.service';
import { computeTicketCompensation } from './compensation-engine';

const ctx = { tenantId: 't1', branchId: 'b1' };
const lines: ServiceLineRow[] = [
  { id: 'L1', service_id: 'svc1', technician_id: 'sam', price_cents_snapshot: 10000, line_total_cents: 10000, commission_type_snapshot: 'percent', commission_value_snapshot: 60 },
  { id: 'L2', service_id: 'svc2', technician_id: 'lily', price_cents_snapshot: 5000, line_total_cents: 5000, commission_type_snapshot: 'percent', commission_value_snapshot: 50 },
  { id: 'R1', service_id: 'prod1', technician_id: 'sam', price_cents_snapshot: 2000, line_total_cents: 2000, commission_type_snapshot: 'percent', commission_value_snapshot: 10, line_kind: 'retail' },
];
const meta = { discountCents: 0, cardTipCents: 3000, cashTipCents: 0, tipMethod: 'by_commission_pool', paidAtIso: '2026-06-26T10:00:00Z' };

function fakePorts(over: Partial<CompensationPorts> = {}): { ports: CompensationPorts; saved: { snap: any[]; tips: any[] } } {
  const saved = { snap: [] as any[], tips: [] as any[] };
  const ports: CompensationPorts = {
    loadServiceLines: async () => lines,
    loadTicketMeta: async () => meta,
    persistSnapshot: async (r) => { saved.snap.push(...r); return r.length; },
    persistTipAllocations: async (r) => { saved.tips.push(...r); return r.length; },
    ...over,
  };
  return { ports, saved };
}

describe('CompensationService orchestrator (§13–§16)', () => {
  it('maps service-line rows to engine input; retail kept separate (§5)', () => {
    const input = engineInputFromLines(ctx, 'tk1', lines, meta);
    expect(input.serviceLines.filter((l) => !l.isRetail).length).toBe(2);
    expect(input.serviceLines.filter((l) => l.isRetail).length).toBe(1);
    const r = computeTicketCompensation(input);
    // L1: 60% of 10000 = 6000 to sam; L2: 50% of 5000 = 2500 to lily
    expect(r.perTechnician.find((t) => t.technicianId === 'sam')!.serviceEarningsCents).toBe(6000);
    expect(r.perTechnician.find((t) => t.technicianId === 'lily')!.serviceEarningsCents).toBe(2500);
    expect(r.perTechnician.find((t) => t.technicianId === 'sam')!.retailCommissionCents).toBe(200); // retail separate
  });

  it('allocates a ticket-level discount across lines proportionally by price', () => {
    const input = engineInputFromLines(ctx, 'tk1', lines, { ...meta, discountCents: 1500 });
    const svc = input.serviceLines.filter((l) => !l.isRetail);
    // $15 across $100/$50 lines → $10 / $5
    expect(svc.find((l) => l.lineId === 'L1')!.discountCents).toBe(1000);
    expect(svc.find((l) => l.lineId === 'L2')!.discountCents).toBe(500);
  });

  it('snapshotPaidTicket persists reconciling snapshot + tip rows (idempotent ports)', async () => {
    const { ports, saved } = fakePorts();
    const svc = new CompensationService(ports);
    const res = await svc.snapshotPaidTicket(ctx, 'tk1');
    expect(res.ok).toBe(true);
    expect(res.reconciled).toBe(true);
    expect(saved.snap.length).toBe(2);  // one row per (service line, tech); retail folds into the tech's totals
    const tipSum = saved.tips.reduce((a, r) => a + r.tip_cents, 0);
    expect(tipSum).toBe(3000);          // all tips allocated, salon 0
    const retailSum = saved.snap.reduce((a, r) => a + r.retail_commission_cents, 0);
    expect(retailSum).toBe(200);        // retail credited exactly once
  });

  it('SAFETY: a persistence failure never throws (payment already captured)', async () => {
    const { ports } = fakePorts({ persistSnapshot: async () => { throw new Error('db down'); } });
    const svc = new CompensationService(ports);
    const res = await svc.snapshotPaidTicket(ctx, 'tk1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/db down/);
    // crucially, it returned a value rather than throwing into the money path
  });

  it('computeForTicket returns null when there are no lines (no fabrication)', async () => {
    const { ports } = fakePorts({ loadServiceLines: async () => [] });
    expect(await new CompensationService(ports).computeForTicket(ctx, 'tk1')).toBeNull();
  });
});

describe('combined tip 50/50 for exactly two technicians (spec §10/§12)', () => {
  // Spec example: Acrylic $70 by A, Nail Art $30 by B — production stays per-line; a combined tip splits 50/50.
  const twoTechLines: ServiceLineRow[] = [
    { id: 'L1', service_id: 'acrylic', technician_id: 'A', price_cents_snapshot: 7000, line_total_cents: 7000, commission_type_snapshot: 'percent', commission_value_snapshot: 100 },
    { id: 'L2', service_id: 'nailart', technician_id: 'B', price_cents_snapshot: 3000, line_total_cents: 3000, commission_type_snapshot: 'percent', commission_value_snapshot: 100 },
  ];
  it('defaults to a 50/50 combined-tip split (NOT proportional) while earnings stay per-line', () => {
    const input = engineInputFromLines(ctx, 'tk1', twoTechLines, { discountCents: 0, cardTipCents: 2000, cashTipCents: 0 });   // tipMethod UNSET
    const r = computeTicketCompensation(input);
    expect(r.perTechnician.find((t) => t.technicianId === 'A')!.cardTipCents).toBe(1000);
    expect(r.perTechnician.find((t) => t.technicianId === 'B')!.cardTipCents).toBe(1000);
    expect(r.perTechnician.find((t) => t.technicianId === 'A')!.serviceEarningsCents).toBe(7000);   // earnings per-line, not split
    expect(r.perTechnician.find((t) => t.technicianId === 'B')!.serviceEarningsCents).toBe(3000);
  });
  it('splits an odd-cent tip deterministically (1501 → 751/750, remainder to the first/primary) and totals match exactly', () => {
    const input = engineInputFromLines(ctx, 'tk1', twoTechLines, { discountCents: 0, cardTipCents: 1501, cashTipCents: 0 });
    const r = computeTicketCompensation(input);
    expect(r.perTechnician.find((t) => t.technicianId === 'A')!.cardTipCents).toBe(751);
    expect(r.perTechnician.find((t) => t.technicianId === 'B')!.cardTipCents).toBe(750);
    expect(r.totals.cardTipCents).toBe(1501);
  });
  it('honours an explicit method (customer-directed / configured) over the 50/50 default', () => {
    const input = engineInputFromLines(ctx, 'tk1', twoTechLines, { discountCents: 0, cardTipCents: 2000, cashTipCents: 0, tipMethod: 'by_service_revenue' });
    const r = computeTicketCompensation(input);
    expect(r.perTechnician.find((t) => t.technicianId === 'A')!.cardTipCents).toBe(1400);   // 70:30 weighted, not 50/50
    expect(r.perTechnician.find((t) => t.technicianId === 'B')!.cardTipCents).toBe(600);
  });
});

describe('3+ technician tip policy (spec §11)', () => {
  const threeTechLines: ServiceLineRow[] = [
    { id: 'L1', service_id: 'a', technician_id: 'A', price_cents_snapshot: 7000, line_total_cents: 7000, commission_type_snapshot: 'percent', commission_value_snapshot: 100 },
    { id: 'L2', service_id: 'b', technician_id: 'B', price_cents_snapshot: 3000, line_total_cents: 3000, commission_type_snapshot: 'percent', commission_value_snapshot: 100 },
    { id: 'L3', service_id: 'c', technician_id: 'C', price_cents_snapshot: 5000, line_total_cents: 5000, commission_type_snapshot: 'percent', commission_value_snapshot: 100 },
  ];
  const tipOf = (r: any, id: string) => r.perTechnician.find((t: any) => t.technicianId === id)!.cardTipCents;

  it('defaults to an EQUAL three-way split (Kevin Nov 13 2026) — not proportional', () => {
    const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', threeTechLines, { discountCents: 0, cardTipCents: 900, cashTipCents: 0 }));
    expect([tipOf(r, 'A'), tipOf(r, 'B'), tipOf(r, 'C')]).toEqual([300, 300, 300]);
  });
  it('splits by earnings only when the salon explicitly chooses proportional', () => {
    const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', threeTechLines, { discountCents: 0, cardTipCents: 900, cashTipCents: 0, manyTechTipMethod: 'proportional' }));
    expect([tipOf(r, 'A'), tipOf(r, 'B'), tipOf(r, 'C')]).toEqual([420, 180, 300]);   // 900 × 70:30:50
  });
  it('splits equally for three technicians when the salon opts into equal', () => {
    const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', threeTechLines, { discountCents: 0, cardTipCents: 900, cashTipCents: 0, manyTechTipMethod: 'equal' }));
    expect([tipOf(r, 'A'), tipOf(r, 'B'), tipOf(r, 'C')]).toEqual([300, 300, 300]);
  });
  it('the equal opt-in does not disturb the two-technician 50/50 rule', () => {
    const two = threeTechLines.slice(0, 2);
    const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', two, { discountCents: 0, cardTipCents: 1000, cashTipCents: 0, manyTechTipMethod: 'equal' }));
    expect(tipOf(r, 'A')).toBe(500); expect(tipOf(r, 'B')).toBe(500);
  });
});

const quiet = { warn: () => undefined, error: () => undefined };

describe('reverseForRefund — §21 refund reversal wiring', () => {
  const snapRows = [
    { service_line_id: 'L1', technician_id: 'A', tech_service_earnings_cents: 7000, salon_service_share_cents: 0, supply_cents: 0, card_tip_cents: 500, cash_tip_cents: 0, retail_commission_cents: 0 },
    { service_line_id: 'L2', technician_id: 'B', tech_service_earnings_cents: 3000, salon_service_share_cents: 0, supply_cents: 0, card_tip_cents: 500, cash_tip_cents: 0, retail_commission_cents: 0 },
  ];
  const basePorts = () => ({ loadServiceLines: async () => [], loadTicketMeta: async () => null, persistSnapshot: async () => 0, persistTipAllocations: async () => 0 } as any);

  // RE-PINNED (merge Oct 12 2026, Payroll mandate §51): a refund is a FACT — entries POST immediately so period earnings
  // drop with the refund. The old "always pending" default left refunded commission counted as earned until approval.
  it('reverses each technician as signed, POSTED entries (snapshot untouched)', async () => {
    const saved: any[] = [];
    const ports = { ...basePorts(), loadSnapshotRows: async () => snapRows, persistAdjustments: async (_c: any, rows: any[]) => { saved.push(...rows); return rows.length; } };
    const out = await new CompensationService(ports, quiet).reverseForRefund(ctx, 'tk', { type: 'full', tipRefunded: true, refundPaymentId: 'rp-1' }, { reason: 'customer refund', requestedBy: 'u1' });
    expect(out.ok).toBe(true);
    expect(out.entries).toBeGreaterThan(0);
    expect(saved.some((e) => e.technicianId === 'A' && e.amountCents < 0)).toBe(true);   // A's attribution reversed
    expect(saved.reduce((s, e) => s + e.amountCents, 0)).toBeLessThan(0);                 // net reversal is negative
    expect(saved.every((e) => e.status === 'posted' && e.refundPaymentId === 'rp-1')).toBe(true);   // posted, keyed by the refund payment
  });
  it('routes reversals to review (pending) ONLY when the tenant flag says so', async () => {
    const saved: any[] = [];
    const ports = { ...basePorts(), loadSnapshotRows: async () => snapRows, persistAdjustments: async (_c: any, rows: any[]) => { saved.push(...rows); return rows.length; }, refundReversalReview: async () => true };
    await new CompensationService(ports, quiet).reverseForRefund(ctx, 'tk', { type: 'full', tipRefunded: true }, { reason: 'customer refund', requestedBy: 'u1' });
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.every((e) => e.status === 'pending')).toBe(true);
  });
  it('is a no-op (ok:false) when there is no snapshot to reverse', async () => {
    const ports = { ...basePorts(), loadSnapshotRows: async () => [], persistAdjustments: async () => 0 };
    expect((await new CompensationService(ports, quiet).reverseForRefund(ctx, 'tk', { type: 'full' }, { reason: 'r', requestedBy: null })).ok).toBe(false);
  });
  it('never throws (best-effort) if persistence fails', async () => {
    const ports = { ...basePorts(), loadSnapshotRows: async () => snapRows, persistAdjustments: async () => { throw new Error('db down'); } };
    const out = await new CompensationService(ports, quiet).reverseForRefund(ctx, 'tk', { type: 'full' }, { reason: 'r', requestedBy: null });
    expect(out.ok).toBe(false);
  });
  it('routes to a FUTURE period when the ticket\'s payroll period is already paid (§9/§21)', async () => {
    const saved: any[] = [];
    const ports = { ...basePorts(), loadSnapshotRows: async () => snapRows, persistAdjustments: async (_c: any, rows: any[]) => { saved.push(...rows); return rows.length; }, isTicketPeriodPaid: async () => true };
    await new CompensationService(ports).reverseForRefund(ctx, 'tk', { type: 'full', tipRefunded: true }, { reason: 'refund', requestedBy: 'u1' });
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.every((e) => e.targetsFuturePeriod === true)).toBe(true);   // never rewrites the locked period
  });
});

describe('merge Oct 12 2026 — line allocations, commission basis, explicit tip rows (mandate §17, §25, §132–§135)', () => {
  it('explicit allocation rows split ONE line between PRIMARY and HELPER by basis points, Σ == the line commission', () => {
    const lines: any[] = [{ id: 'L1', service_id: 's', technician_id: 'lisa', price_cents_snapshot: 10000, line_total_cents: 10000, commission_type_snapshot: 'percent', commission_value_snapshot: 60,
      allocations: [{ technicianId: 'lisa', shareBps: 6000, role: 'PRIMARY' }, { technicianId: 'mary', shareBps: 4000, role: 'HELPER' }] }];
    const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', lines, { discountCents: 0, cardTipCents: 0, cashTipCents: 0 }));
    const earn = (id: string) => r.perTechnician.find((t) => t.technicianId === id)?.serviceEarningsCents ?? 0;
    expect(earn('lisa')).toBe(3600); expect(earn('mary')).toBe(2400);
    expect(earn('lisa') + earn('mary')).toBe(6000);
  });
  it('a line with no allocation rows pays its technician_id at 100% (every existing ticket unchanged)', () => {
    const lines: any[] = [{ id: 'L1', service_id: 's', technician_id: 'lisa', price_cents_snapshot: 10000, line_total_cents: 10000, commission_type_snapshot: 'percent', commission_value_snapshot: 60, allocations: [] }];
    const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', lines, { discountCents: 0, cardTipCents: 0, cashTipCents: 0 }));
    expect(r.perTechnician.find((t) => t.technicianId === 'lisa')!.serviceEarningsCents).toBe(6000);
  });
  it('the basis is line_total_cents (the charged price), a removed line is excluded, and the line rule provenance rides to the engine input', () => {
    const lines: any[] = [
      { id: 'L1', service_id: 's', technician_id: 'lisa', price_cents_snapshot: 10000, line_total_cents: 8000, commission_type_snapshot: 'percent', commission_value_snapshot: 50, policy_id: 'pol-1', rule_source: 'Technician + Service' },
      { id: 'L2', service_id: 's', technician_id: 'lisa', price_cents_snapshot: 5000, line_total_cents: 5000, commission_type_snapshot: 'percent', commission_value_snapshot: 50, removed_at: '2026-10-12T00:00:00.000Z' },
    ];
    const input = engineInputFromLines(ctx, 'tk', lines, { discountCents: 0, cardTipCents: 0, cashTipCents: 0 });
    expect(input.serviceLines).toHaveLength(1);
    expect(input.serviceLines[0].priceCents).toBe(8000);
    expect(input.serviceLines[0]).toMatchObject({ policyId: 'pol-1', ruleSource: 'Technician + Service' });
    expect(computeTicketCompensation(input).perTechnician[0].serviceEarningsCents).toBe(4000);
  });
  it('an explicit tip allocation already on file (ticket_tip_allocations) wins over every default split (§25)', () => {
    const lines: any[] = [
      { id: 'L1', service_id: 's', technician_id: 'lisa', price_cents_snapshot: 7000, line_total_cents: 7000, commission_type_snapshot: 'percent', commission_value_snapshot: 100 },
      { id: 'L2', service_id: 's', technician_id: 'mary', price_cents_snapshot: 3000, line_total_cents: 3000, commission_type_snapshot: 'percent', commission_value_snapshot: 100 },
    ];
    const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', lines, { discountCents: 0, cardTipCents: 2101, cashTipCents: 0, directedTips: [{ technicianId: 'lisa', tipCents: 1500 }, { technicianId: 'mary', tipCents: 601 }] }));
    const tip = (id: string) => { const t = r.perTechnician.find((x) => x.technicianId === id)!; return t.cardTipCents + t.cashTipCents; };
    expect(tip('lisa')).toBe(1500); expect(tip('mary')).toBe(601);
    expect(r.reconciliation.tipsReconcile).toBe(true);
  });
  it('snapshotPaidTicket logs a stable failure marker instead of staying silent (mandate §195)', async () => {
    const logged: any[] = [];
    const ports = { loadServiceLines: async () => { throw new Error('db down'); }, loadTicketMeta: async () => null, persistSnapshot: async () => 0, persistTipAllocations: async () => 0 } as any;
    const out = await new CompensationService(ports, { warn: () => undefined, error: (m, x) => logged.push({ m, x }) }).snapshotPaidTicket(ctx, 'tk');
    expect(out.ok).toBe(false);
    expect(logged[0]).toMatchObject({ m: 'compensation_snapshot_failed', x: { ticketId: 'tk', error: 'db down' } });
  });
});
