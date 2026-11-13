import { describe, it, expect } from 'vitest';
import { canTransition, suggestSeverity, buildExceptionsState, validateCreateException, caseDue, EXCEPTION_REVIEW_DAYS, type ReconException } from './deposit-reconciliation.exceptions';
import { InMemoryExceptionsRepository } from './deposit-reconciliation.exceptions.repository';
import { ExceptionWorkflowService } from './deposit-reconciliation.exceptions.service';
import { ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';

const ctx = (t = 't1') => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['reconciliation.manage', 'reconciliation.approve'] } as any);

describe('exceptions — state machine (pure)', () => {
  it('allows sensible transitions only', () => {
    expect(canTransition('open', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'reopened')).toBe(true);
    expect(canTransition('resolved', 'in_review')).toBe(false);
    expect(canTransition('open', 'reopened')).toBe(false);
  });
  it('suggests severity from kind + amount', () => {
    expect(suggestSeverity('missing_deposit', 150000)).toBe('critical');
    expect(suggestSeverity('fee_difference', 100)).toBe('low');
  });
});

describe('exceptions — KPIs (pure)', () => {
  it('counts active + amount at risk (excludes resolved)', () => {
    const mk = (o: Partial<ReconException>): ReconException => ({ id: 'e', branchId: null, kind: 'missing_deposit', severity: 'high', title: 't', detail: null, amountCents: 1000, currency: 'USD', status: 'open', sourceRef: null, assignedToUserId: null, resolutionNote: null, resolvedByUserId: null, resolvedAt: null, createdAt: '2026-07-01', ...o });
    const st = buildExceptionsState([mk({ id: 'e1', status: 'open', amountCents: 1000 }), mk({ id: 'e2', status: 'resolved', amountCents: 9999, severity: 'critical' }), mk({ id: 'e3', status: 'escalated', severity: 'critical', amountCents: 500 })]);
    expect(st.kpis.open).toBe(1); expect(st.kpis.resolved).toBe(1); expect(st.kpis.escalated).toBe(1);
    expect(st.kpis.critical).toBe(1);          // only the non-resolved critical
    expect(st.kpis.amountAtRiskCents).toBe(1500); // resolved excluded
  });
});

describe('round 10 — AI Deposit Reconciliation 01: per-case review due date (pure)', () => {
  it('due = created + the severity\'s review days; unresolved past it is overdue; resolved never overdue; counted in the KPIs', () => {
    const mk = (o: Partial<ReconException>): ReconException => ({ id: 'e', branchId: null, kind: 'missing_deposit', severity: 'high', title: 't', detail: null, amountCents: 1000, currency: 'USD', status: 'open', sourceRef: null, assignedToUserId: null, resolutionNote: null, resolvedByUserId: null, resolvedAt: null, createdAt: '2026-11-01T12:00:00.000Z', ...o });
    const now = new Date('2026-11-04T12:00:00.000Z');
    const st = buildExceptionsState([mk({ id: 'crit', severity: 'critical' }), mk({ id: 'mod', severity: 'moderate' }), mk({ id: 'done', severity: 'critical', status: 'resolved' }), mk({ id: 'bad', createdAt: '' })], now);
    const by = Object.fromEntries(st.items.map((i) => [i.id, i]));
    expect(by.crit).toMatchObject({ dueAt: '2026-11-02T12:00:00.000Z', overdue: true });
    expect(by.mod).toMatchObject({ dueAt: '2026-11-06T12:00:00.000Z', overdue: false });
    expect(by.done).toMatchObject({ overdue: false });
    expect(by.bad).toMatchObject({ dueAt: null, overdue: false });
    expect(st.kpis.overdue).toBe(1);
    expect(EXCEPTION_REVIEW_DAYS).toEqual({ critical: 1, high: 2, moderate: 5, low: 10, info: 14 });
    expect(caseDue({ severity: 'low', createdAt: '2026-11-01T00:00:00.000Z', status: 'reopened' }, new Date('2026-11-20T00:00:00.000Z')).overdue).toBe(true);
  });
});

describe('exceptions — workflow service', () => {
  it('rejects unauthenticated + validates create', async () => {
    const svc = new ExceptionWorkflowService(new InMemoryExceptionsRepository());
    await expect(svc.getState({ ...ctx(), userId: '' })).rejects.toBeInstanceOf(ReconForbiddenError);
    await expect(svc.create(ctx(), { kind: 'nope' as any, title: 'x' })).rejects.toBeInstanceOf(ReconValidationError);
  });
  it('create suggests severity; assign moves open -> in_review', async () => {
    const svc = new ExceptionWorkflowService(new InMemoryExceptionsRepository());
    const e = await svc.create(ctx(), { kind: 'missing_deposit', title: 'Missing $2k deposit', amountCents: 200000 });
    expect(e.severity).toBe('critical'); expect(e.status).toBe('open');
    const a = await svc.assign(ctx(), e.id, 'aaaaaaaa-0000-0000-0000-0000000000c3');
    expect(a.assignedToUserId).toBe('aaaaaaaa-0000-0000-0000-0000000000c3'); expect(a.status).toBe('in_review');
  });
  it('resolve REQUIRES a note and stamps the approver; cannot resolve via transition', async () => {
    const svc = new ExceptionWorkflowService(new InMemoryExceptionsRepository());
    const e = await svc.create(ctx(), { kind: 'fee_difference', title: 'Fee off', amountCents: 600 });
    await expect(svc.resolve(ctx(), e.id, '   ')).rejects.toBeInstanceOf(ReconValidationError); // no note
    await expect(svc.transition(ctx(), e.id, 'resolved' as any)).rejects.toBeInstanceOf(ReconValidationError); // must use resolve
    const r = await svc.resolve(ctx(), e.id, 'Processor confirmed the fee; documented.');
    expect(r.status).toBe('resolved'); expect(r.resolvedByUserId).toBe('u1'); expect(r.resolutionNote).toMatch(/documented/);
  });
  it('reopen only a resolved case; blocks illegal transitions', async () => {
    const svc = new ExceptionWorkflowService(new InMemoryExceptionsRepository());
    const e = await svc.create(ctx(), { kind: 'duplicate', title: 'Dup deposit', amountCents: 5000 });
    await expect(svc.reopen(ctx(), e.id)).rejects.toBeInstanceOf(ReconValidationError); // not resolved yet
    await svc.resolve(ctx(), e.id, 'Confirmed not a duplicate.');
    const re = await svc.reopen(ctx(), e.id); expect(re.status).toBe('reopened'); expect(re.resolvedAt).toBeNull();
  });
  it('isolation: tenant B cannot see or mutate tenant A cases', async () => {
    const repo = new InMemoryExceptionsRepository();
    const svc = new ExceptionWorkflowService(repo);
    const e = await svc.create(ctx('t1'), { kind: 'other', title: 'A case', amountCents: 100 });
    expect((await svc.getState(ctx('t2'))).items.length).toBe(0);
    await expect(svc.resolve(ctx('t2'), e.id, 'x')).rejects.toBeInstanceOf(ReconValidationError); // not found for t2
  });
});
