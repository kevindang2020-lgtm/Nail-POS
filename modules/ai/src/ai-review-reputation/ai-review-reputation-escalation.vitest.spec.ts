// ai-review-reputation-escalation.vitest.spec.ts — escalation + recovery. Financial recovery is recorded-only (never
// executed, always requiresAuthorization); escalation notifications carry no PII; raise is idempotent; the escalation
// state machine and permission gates are enforced.
import { describe, it, expect } from 'vitest';
import { recommendRecoveryActions, buildSecureNotification, transitionEscalation, buildEscalation, isFinancialAction } from './ai-review-reputation-recovery';
import { EscalationService, EscalationForbiddenError, type EscalationStorePort, type SecureNotifyPort, type RecoveryStorePort, type ReviewStatusPort } from './ai-review-reputation-escalation.service';
import { analyzeReview } from './ai-review-reputation-core';

const burn = analyzeReview({ text: 'chemical burn on my finger', rating: 1 });

describe('recovery recommendations', () => {
  it('recommends appropriate actions; financial actions are advisory + require authorization', () => {
    const b = recommendRecoveryActions(burn, 1);
    expect(b.map((r) => r.type)).toEqual(expect.arrayContaining(['manager_call', 'sanitation_investigation', 'escalate_owner']));
    const billing = recommendRecoveryActions(analyzeReview({ text: 'you charged me twice, unauthorized charge', rating: 1 }), 1);
    expect(billing.map((r) => r.type)).toEqual(expect.arrayContaining(['payment_investigation', 'partial_refund_review']));
    expect(billing.filter((r) => isFinancialAction(r.type)).every((r) => r.requiresAuthorization && r.delegatesTo && r.autoExecute === false)).toBe(true);
    const nail = recommendRecoveryActions(analyzeReview({ text: 'you damaged my nail, wrong shape', rating: 2 }), 2);
    expect(nail.filter((r) => !isFinancialAction(r.type)).every((r) => r.requiresAuthorization === false)).toBe(true);
  });
});

describe('secure notification + state machine', () => {
  it('is link-only with no PII', () => {
    const n = buildSecureNotification('rev1', 'critical', 'https://app.example/');
    expect(n.containsPii).toBe(false);
    expect(n.secureLink).toContain('/reviews/rev1');
    expect(n.summary).not.toMatch(/burn|phone|\$/);
  });
  it('enforces escalation transitions', () => {
    expect(transitionEscalation(transitionEscalation('open', 'acknowledged'), 'resolved')).toBe('resolved');
    expect(() => transitionEscalation('resolved', 'open')).toThrow('INVALID_ESCALATION_TRANSITION');
    expect(buildEscalation(analyzeReview({ text: 'nice', rating: 5 }))).toBeNull();
  });
});

describe('escalation service', () => {
  function make() {
    const esc: any = {}; let seq = 0; let notified: any = null; const reviewStatus: any = { esc: {}, res: {} }; let recorded: any = null;
    const store: EscalationStorePort = {
      async findByReview(_c, rid) { return esc[rid] ? { id: esc[rid].id, status: esc[rid].status } : null; },
      async create(_c, rid, sev, sig) { const id = 'e' + (++seq); esc[rid] = { id, reviewId: rid, severity: sev, signals: sig, status: 'open', createdAt: new Date(2026, 6, seq).toISOString() }; return { id }; },
      async setStatus(_c, id, st) { const row: any = Object.values(esc).find((x: any) => x.id === id); if (row) row.status = st; },
      async assign() {}, async listOpen() { return Object.values(esc).filter((x: any) => x.status !== 'resolved') as any; },
    };
    const notify: SecureNotifyPort = { async sendSecure(_c, _r, payload) { notified = payload; } };
    const recovery: RecoveryStorePort = { async record(_c, rid, type) { recorded = { rid, type }; return { id: 'ra1', status: 'recommended' }; } };
    const rs: ReviewStatusPort = { async setEscalationStatus(_c, rid, st) { reviewStatus.esc[rid] = st; }, async setResolution(_c, rid, st) { reviewStatus.res[rid] = st; } };
    return { svc: new EscalationService(store, notify, recovery, rs, undefined, 'https://app.example'), esc, get notified() { return notified; }, get recorded() { return recorded; }, reviewStatus };
  }
  const ctx: any = { tenantId: 'A', branchId: 'b1', userId: 'u', role: 'MANAGER', permissions: ['marketing.manage', 'marketing.view'] };

  it('raises idempotently with a PII-free notification, resolves, and records financial recovery without executing it', async () => {
    const h = make();
    const r1 = await h.svc.raise(ctx, 'rev1', burn, ['manager@salon']);
    expect(r1.created).toBe(true);
    expect(h.reviewStatus.esc['rev1']).toBe('escalated');
    expect(h.notified.containsPii).toBe(false);
    expect((await h.svc.raise(ctx, 'rev1', burn, [])).created).toBe(false);
    await h.svc.acknowledge(ctx, r1.escalationId);
    await h.svc.resolve(ctx, r1.escalationId, 'rev1');
    expect(h.esc['rev1'].status).toBe('resolved');
    expect(h.reviewStatus.res['rev1']).toBe('resolved');
    const rec = await h.svc.recordRecoveryAction(ctx, 'rev1', 'full_refund_review');
    expect(rec.requiresAuthorization).toBe(true);
    expect(rec.executed).toBe(false);
    await expect(h.svc.acknowledge({ ...ctx, permissions: [] }, r1.escalationId)).rejects.toBeInstanceOf(EscalationForbiddenError);
  });

  it('orders the urgent queue critical-first', async () => {
    const h = make();
    await h.svc.raise(ctx, 'a', analyzeReview({ text: 'harassment by staff', rating: 1 }), []);
    await h.svc.raise(ctx, 'b', analyzeReview({ text: 'chemical burn', rating: 1 }), []);
    expect((await h.svc.urgentQueue(ctx))[0].severity).toBe('critical');
  });
});
