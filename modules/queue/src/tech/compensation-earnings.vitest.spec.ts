// compensation-earnings.vitest.spec.ts — §16 receipt + §17 summary pure builders, and the TechService canonical
// earnings methods proving server-side technician isolation (uses the resolved id, never a client-supplied one).
import { describe, it, expect } from 'vitest';
import { technicianEarningsSummary, ticketEarningsReceipt, type EarningsSnapshotRow } from '@aipowersalon/workforce';
import { TechService } from './tech.service';
import { permissionsFor } from '@aipowersalon/permissions';
import type { TechDataPort } from './tech.repository';

describe('compensation earnings (§16/§17)', () => {
  it('§17 summary from snapshot sums; payroll-only fields honestly null; estimated total', () => {
    const s = technicianEarningsSummary({ techServiceEarningsCents: 14000, cardTipCents: 6000, cashTipCents: 1000, retailCommissionCents: 500, tickets: 5 });
    expect(s.serviceCommissionCents).toBe(14000);
    expect(s.tipsCents).toBe(7000);
    expect(s.retailCommissionCents).toBe(500);
    expect(s.bonusCents).toBeNull();
    expect(s.guaranteeTopUpCents).toBeNull();
    expect(s.estimatedEarningsCents).toBe(21500); // 14000 + 500 + 7000
    expect(s.status).toBe('estimated');
  });

  it('§16 receipt: per-line breakdown + tips (salon 0) + totals', () => {
    const rows: EarningsSnapshotRow[] = [
      { service_line_id: 'L1', service_id: 'svc1', gross_price_cents: 10000, discount_cents: 1000, supply_cents: 1000, commissionable_cents: 8000, commission_type: 'percent', commission_value: 60, tech_service_earnings_cents: 4800, card_tip_cents: 2000, cash_tip_cents: 0, retail_commission_cents: 0 },
    ];
    const r = ticketEarningsReceipt('tk1', rows);
    expect(r.lines[0].eligibleAfterDiscountCents).toBe(9000);
    expect(r.lines[0].commissionableCents).toBe(8000);
    expect(r.lines[0].techServiceEarningsCents).toBe(4800);
    expect(r.totalTipCents).toBe(2000);
    expect(r.salonTipCents).toBe(0);
    expect(r.totalEarningsCents).toBe(6800); // 4800 + 2000
  });
});

// ── isolation: TechService uses the SERVER-resolved technician id, never the caller's ──
function techPort(): TechDataPort {
  return { technicianAppEnabled: async () => true, resolveTechnicianId: async () => 'tech1', recordAudit: async () => {} } as unknown as TechDataPort;
}
const ctx = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') } as any;

describe('TechService canonical earnings — isolation', () => {
  it('summary queries the snapshot with the RESOLVED technician id (not a client id)', async () => {
    const seen: any = {};
    const compReads = {
      sumByTechnicianPeriod: async (tenant: string, tech: string) => { seen.tenant = tenant; seen.tech = tech; return { techServiceEarningsCents: 5000, cardTipCents: 1000, cashTipCents: 0, retailCommissionCents: 0, tickets: 2 }; },
      getByTicketForTechnician: async () => [],
    };
    const svc = new TechService(techPort(), undefined, undefined, compReads);
    const out = await svc.getCanonicalEarnings(ctx, 'week');
    expect(seen.tenant).toBe('T');
    expect(seen.tech).toBe('tech1');            // the server-resolved id, regardless of caller input
    expect(out!.serviceCommissionCents).toBe(5000);
  });

  it('receipt is scoped to the resolved technician', async () => {
    const seen: any = {};
    const compReads = {
      sumByTechnicianPeriod: async () => ({ techServiceEarningsCents: 0, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, tickets: 0 }),
      getByTicketForTechnician: async (tenant: string, ticket: string, tech: string) => { seen.tech = tech; seen.ticket = ticket; return [{ service_line_id: 'L1', service_id: 's', gross_price_cents: 5000, discount_cents: 0, supply_cents: 0, commissionable_cents: 5000, commission_type: 'percent', commission_value: 50, tech_service_earnings_cents: 2500, card_tip_cents: 0, cash_tip_cents: 0, retail_commission_cents: 0 }]; },
    };
    const svc = new TechService(techPort(), undefined, undefined, compReads);
    const r = await svc.getTicketEarningsReceipt(ctx, 'tk9');
    expect(seen.tech).toBe('tech1');
    expect(seen.ticket).toBe('tk9');
    expect(r!.totalEarningsCents).toBe(2500);
  });

  it('returns null when no snapshot source is wired (honest, no fabrication)', async () => {
    const svc = new TechService(techPort());
    expect(await svc.getCanonicalEarnings(ctx, 'day')).toBeNull();
  });
});

// merge Oct 12 2026 (PAY — other chat's earnings-period.ts, Payroll mandate §126–§128): the canonical read resolves its
// window in the TENANT's timezone, half-open, with pay_period mapped from the payroll row; per-line detail rides along.
describe('TechService canonical earnings — tenant-zone, half-open window (earnings-period.ts)', () => {
  const sums = { techServiceEarningsCents: 0, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, tickets: 0 };
  it('"day" is the tenant\'s civil day (America/New_York), [00:00 local, next 00:00 local)', async () => {
    const seen: any = {};
    const compReads = { tenantTimezone: async () => 'America/New_York', sumByTechnicianPeriod: async (_t: string, _x: string, f: string, to: string) => { seen.f = f; seen.to = to; return sums; }, getByTicketForTechnician: async () => [], linesByTechnicianPeriod: async () => [{ serviceName: 'Gel', lineTotalCents: 5000, commissionCents: 2500, completedAt: '2026-10-08T15:00:00.000Z', ticketId: 'tk', ruleSource: 'Tenant default rate' }] };
    const out: any = await new TechService(techPort(), undefined, undefined, compReads as any).getCanonicalEarnings(ctx, 'day', '2026-10-08T15:00:00.000Z');
    expect(seen.f).toBe('2026-10-08T04:00:00.000Z');
    expect(seen.to).toBe('2026-10-09T04:00:00.000Z');
    expect(out.timezone).toBe('America/New_York');
    expect(out.lines).toHaveLength(1);
  });
  it('pay_period maps the payroll row onto [start, end + 1 day) and requires the id', async () => {
    const seen: any = {};
    const compReads = { tenantTimezone: async () => 'UTC', payrollPeriod: async (_t: string, id: string) => (id === 'pp1' ? { id: 'pp1', periodStart: '2026-09-28', periodEnd: '2026-10-11', status: 'draft' } : null), sumByTechnicianPeriod: async (_t: string, _x: string, f: string, to: string) => { seen.f = f; seen.to = to; return sums; }, getByTicketForTechnician: async () => [] };
    const svc = new TechService(techPort(), undefined, undefined, compReads as any);
    const out: any = await svc.getCanonicalEarnings(ctx, 'pay_period' as any, undefined, undefined, 'pp1');
    expect(seen.f).toBe('2026-09-28T00:00:00.000Z');
    expect(seen.to).toBe('2026-10-12T00:00:00.000Z');
    expect(out.payPeriodId).toBe('pp1');
    await expect(svc.getCanonicalEarnings(ctx, 'pay_period' as any)).rejects.toThrow(/payPeriodId/);
    await expect(svc.getCanonicalEarnings(ctx, 'pay_period' as any, undefined, undefined, 'nope')).rejects.toThrow(/not found/i);
  });
});

// ── Oct 13 2026 (FLOW, duplicate D1): the Tech App DASHBOARD and /tech/earnings read the compensation snapshot (the ONE
// payroll authority, tenant-zone day) whenever a snapshot source is wired — never the per-line "price × stamped rate"
// estimate, which ignores discount allocation, authored commission rules and posted reversals. The estimate stays ONLY
// as the fallback when no snapshot source exists (in-memory/demo).
describe('TechService dashboard + earnings read the snapshot authority (D1 merge)', () => {
  const rawPort = (): TechDataPort => ({
    ...techPort(),
    // the line estimate would say $60.00 commission on $100.00 of sales
    dashboardRaw: async () => ({ technician: { technicianId: 'tech1', fullName: 'Lisa', initials: 'L', roleLabel: '', status: 'available' }, todayLines: [{ lineTotalCents: 10000, commissionType: 'percent', commissionValue: 60, tipCents: 0 }], bookings: 1, completed: 1, inService: 0, salesTrendPercent: 0, hasAssignedUnacceptedTicket: false, hasAcceptedNotStarted: false }),
    earningsTips: async () => 999,
  } as unknown as TechDataPort);
  const windows: string[][] = [];
  const compReads = {
    // the snapshot (authored rule 50 % after a $10 discount allocation, minus a posted $5 reversal) says $40.00 on $90.00
    sumByTechnicianPeriod: async (_t: string, _tech: string, fromIso: string, toIso: string) => { windows.push([fromIso, toIso]); return { techServiceEarningsCents: 4500, cardTipCents: 1200, cashTipCents: 300, retailCommissionCents: 0, grossServiceCents: 9000, tickets: 1, adjustmentsCents: -500 }; },
    getByTicketForTechnician: async () => [],
    tenantTimezone: async () => 'America/New_York',
  };

  it('the dashboard earnings tile equals the snapshot (commission incl. posted reversals, tips card + cash, gross service sales) in the salon-zone day', async () => {
    const svc = new TechService(rawPort(), undefined, undefined, compReads as any);
    const noon = Date.UTC(2026, 9, 13, 16, 0, 0);   // 2026-10-13 12:00 in New York
    const st = await svc.getDashboard(ctx, noon);
    expect(st.earnings).toEqual({ todaySalesCents: 9000, tipsCents: 1500, estimatedCommissionCents: 4000 });
    // the window is the New York day, not the UTC day of the process
    expect(windows.at(-1)).toEqual(['2026-10-13T04:00:00.000Z', '2026-10-14T04:00:00.000Z']);
  });

  it('/tech/earnings says the same numbers as the dashboard and the canonical read', async () => {
    const svc = new TechService(rawPort(), undefined, undefined, compReads as any);
    const e = await svc.getEarnings(ctx);
    expect(e).toEqual({ todaySalesCents: 9000, tipsCents: 1500, estimatedCommissionCents: 4000 });
    const c = await svc.getCanonicalEarnings(ctx, 'day');
    expect(c!.serviceCommissionCents + (c!.adjustmentsCents ?? 0)).toBe(e.estimatedCommissionCents);
    expect(c!.tipsCents).toBe(e.tipsCents);
  });

  // ONE-PAY F1 (Oct 13 2026): there is no second formula — without the authority the money is unknown, never estimated.
  it('without a snapshot source there is NO estimate: commission and tips are null with a note (sales still from the lines)', async () => {
    const svc = new TechService(rawPort());
    const e = await svc.getEarnings(ctx);
    expect(e.estimatedCommissionCents).toBeNull();
    expect(e.tipsCents).toBeNull();
    expect(e.note).toMatch(/payroll/i);
    expect(e.todaySalesCents).toBe(10000);
    const st = await svc.getDashboard(ctx, Date.UTC(2026, 9, 13, 16));
    expect(st.earnings.estimatedCommissionCents).toBeNull();
    expect(st.earnings.tipsCents).toBeNull();
  });
  it('a failing snapshot read is null too — never the line estimate', async () => {
    const broken = { ...compReads, sumByTechnicianPeriod: async () => { throw new Error('db down'); } };
    const svc = new TechService(rawPort(), undefined, undefined, broken as any);
    const e = await svc.getEarnings(ctx);
    expect(e.estimatedCommissionCents).toBeNull();
    expect(e.tipsCents).toBeNull();
  });
});
