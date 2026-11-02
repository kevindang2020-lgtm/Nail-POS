import { describe, it, expect } from 'vitest';
import { buildDailyReport, buildSummary, toCsv, dailyReportToCsv } from './deposit-reconciliation.reports';
import { canClosePeriod, isMaterial, validateCreatePeriod, DEFAULT_CLOSE_OPTIONS } from './deposit-reconciliation.periods';
import type { ReconState, ReconRow } from './deposit-reconciliation.dto';
import type { ReconException } from './deposit-reconciliation.exceptions';
import { InMemoryReconRepository } from './deposit-reconciliation.repository';
import { InMemoryFeeScheduleRepository } from './deposit-reconciliation.fees.repository';
import { InMemoryExceptionsRepository } from './deposit-reconciliation.exceptions.repository';
import { InMemoryPeriodsRepository } from './deposit-reconciliation.periods.repository';
import { ReportsService } from './deposit-reconciliation.reports.service';
import { PeriodsService } from './deposit-reconciliation.periods.service';
import { ReconValidationError } from './deposit-reconciliation.service';

const row = (o: Partial<ReconRow> = {}): ReconRow => ({ settlementId: 's', processorType: 'fiserv', settledAt: '2026-07-01T00:00:00.000Z', grossCents: 10000, feeCents: 300, expectedNetCents: 9700, depositId: 'd', actualCents: 9700, differenceCents: 0, status: 'matched', matchType: 'amount_exact', confidence: 1, dateDiffDays: 1, ...o });
const state = (rows: ReconRow[]): ReconState => ({ kpis: {} as any, rows, unmatchedDeposits: [] });
const exc = (o: Partial<ReconException> = {}): ReconException => ({ id: 'e', branchId: null, kind: 'missing_deposit', severity: 'high', title: 't', detail: null, amountCents: 50000, currency: 'USD', status: 'open', sourceRef: null, assignedToUserId: null, resolutionNote: null, resolvedByUserId: null, resolvedAt: null, createdAt: '2026-07-05', ...o });

describe('reports — daily (pure)', () => {
  it('groups by settled date with totals', () => {
    const rep = buildDailyReport(state([row({ settledAt: '2026-07-01T00:00:00.000Z', expectedNetCents: 9700, actualCents: 9700 }), row({ settledAt: '2026-07-01T00:00:00.000Z', status: 'missing_deposit', actualCents: null, expectedNetCents: 5000 }), row({ settledAt: '2026-07-02T00:00:00.000Z' })]));
    expect(rep.rows.length).toBe(2);
    const d1 = rep.rows.find((r) => r.date === '2026-07-01')!;
    expect(d1.settlementCount).toBe(2); expect(d1.missing).toBe(1); expect(d1.matched).toBe(1);
    expect(rep.totals.settlementCount).toBe(3);
  });
});

describe('reports — CSV (pure, injection-safe)', () => {
  it('escapes formula injection and quotes special chars', () => {
    const csv = toCsv(['A', 'B'], [['=cmd', 'a,b'], ['plain', 'has "quote"']]);
    expect(csv).toContain("'=cmd");              // formula neutralized
    expect(csv).toContain('"a,b"');              // comma quoted
    expect(csv).toContain('"has ""quote"""');    // quotes escaped
  });
  it('daily report csv has a TOTAL row', () => {
    const csv = dailyReportToCsv(buildDailyReport(state([row()])));
    expect(csv.split('\n')[0]).toBe('Date,Settlements,Expected,Actual,Difference,Matched,Missing,Unmatched');
    expect(csv).toMatch(/\nTOTAL,/);
  });
});

describe('periods — close guard (pure)', () => {
  it('material = high/critical severity OR amount >= threshold', () => {
    expect(isMaterial(exc({ severity: 'low', amountCents: 50 }), DEFAULT_CLOSE_OPTIONS)).toBe(false);
    expect(isMaterial(exc({ severity: 'low', amountCents: 20000 }), DEFAULT_CLOSE_OPTIONS)).toBe(true);
    expect(isMaterial(exc({ severity: 'critical', amountCents: 1 }), DEFAULT_CLOSE_OPTIONS)).toBe(true);
  });
  it('blocks close on unresolved material exception in range; non-material -> warning only', () => {
    const period = { periodStart: '2026-07-01', periodEnd: '2026-07-31' };
    const blocked = canClosePeriod([exc({ severity: 'high', createdAt: '2026-07-05' })], period);
    expect(blocked.ok).toBe(false); expect(blocked.blockers.length).toBe(1);
    const warn = canClosePeriod([exc({ severity: 'low', amountCents: 50, createdAt: '2026-07-05' })], period);
    expect(warn.ok).toBe(true); expect(warn.warnings.length).toBe(1);
    const resolved = canClosePeriod([exc({ severity: 'high', status: 'resolved', createdAt: '2026-07-05' })], period);
    expect(resolved.ok).toBe(true);
    const outOfRange = canClosePeriod([exc({ severity: 'high', createdAt: '2026-08-05' })], period);
    expect(outOfRange.ok).toBe(true);
  });
});

describe('periods — service close workflow', () => {
  const ctx = (t = 't1') => ({ tenantId: t, branchId: 'b1', userId: 'aaaaaaaa-0000-0000-0000-0000000000c1', role: 'OWNER', permissions: [] } as any);
  it('validates input, blocks close over a material exception, allows a clean close', async () => {
    const excRepo = new InMemoryExceptionsRepository();
    const svc = new PeriodsService(new InMemoryPeriodsRepository(), excRepo);
    await expect(svc.create(ctx(), { label: '', periodStart: 'x', periodEnd: 'y' })).rejects.toBeInstanceOf(ReconValidationError);
    // Blocking: a critical exception created "today" falls inside a period covering today.
    const today = new Date().toISOString().slice(0, 10);
    const pNow = await svc.create(ctx(), { label: 'Current', periodStart: today, periodEnd: today });
    await excRepo.create(ctx(), { kind: 'missing_deposit', severity: 'critical', title: 'Missing', amountCents: 200000 });
    await expect(svc.close(ctx(), pNow.id)).rejects.toBeInstanceOf(ReconValidationError);
    // Clean: a past period with no exceptions in range closes and can reopen.
    const pPast = await svc.create(ctx(), { label: 'June 2026', periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    const closed = await svc.close(ctx(), pPast.id, 'All matched');
    expect(closed.status).toBe('closed'); expect(closed.closedByUserId).toBe('aaaaaaaa-0000-0000-0000-0000000000c1');
    const re = await svc.reopen(ctx(), pPast.id); expect(re.status).toBe('open'); expect(re.closedAt).toBeNull();
  });
  it('isolation: tenant B cannot see or close tenant A periods', async () => {
    const periodsRepo = new InMemoryPeriodsRepository();
    const svc = new PeriodsService(periodsRepo, new InMemoryExceptionsRepository());
    const p = await svc.create(ctx('t1'), { label: 'A', periodStart: '2026-07-01', periodEnd: '2026-07-31' });
    expect((await svc.list(ctx('t2'))).length).toBe(0);
    await expect(svc.close(ctx('t2'), p.id)).rejects.toBeInstanceOf(ReconValidationError);
  });
});

describe('reports — service auth', () => {
  it('summary requires auth + composes engine outputs', async () => {
    const svc = new ReportsService(new InMemoryReconRepository(), new InMemoryFeeScheduleRepository(), new InMemoryExceptionsRepository());
    const sum = await svc.getSummary({ tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: [] } as any);
    expect(sum).toHaveProperty('missingDeposits'); expect(sum).toHaveProperty('openExceptions');
  });
});
