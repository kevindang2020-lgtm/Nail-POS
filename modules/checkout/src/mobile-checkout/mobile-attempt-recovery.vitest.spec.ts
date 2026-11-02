// mobile-attempt-recovery.vitest.spec.ts — mandate §74–§78: the unresolved-attempt recovery decides ONLY from the
// provider's answer, never charges, never guesses; the worker is idempotent and hands the undecidable to a human.
import { describe, it, expect, vi } from 'vitest';
import { decideRecovery, MobileAttemptRecoveryWorker, NOT_FOUND_RELEASE_MS, DEFAULT_STALE_MS, UNREACHABLE_REVIEW_FACTOR } from './mobile-attempt-recovery';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import type { Ctx } from '@aipowersalon/permissions';

const ctx: Ctx = { tenantId: 'T1', branchId: 'B1', userId: 'u1', role: 'OWNER', permissions: [] };

describe('decideRecovery (pure)', () => {
  it('approved → confirm with the reference; declined → decline', () => {
    expect(decideRecovery({ kind: 'approved', processorRef: 'R1', capturedAmountCents: 500 }, { ageMs: 0 })).toEqual({ action: 'confirm', processorRef: 'R1', capturedAmountCents: 500, cardBrand: undefined, cardLast4: undefined });
    expect(decideRecovery({ kind: 'declined', processorRef: 'R2' }, { ageMs: 0 })).toEqual({ action: 'decline', processorRef: 'R2' });
  });
  it('not found: wait inside the release window, release after it (FD22)', () => {
    expect(decideRecovery({ kind: 'not_found' }, { ageMs: NOT_FOUND_RELEASE_MS - 1 }).action).toBe('wait');
    expect(decideRecovery({ kind: 'not_found' }, { ageMs: NOT_FOUND_RELEASE_MS })).toEqual({ action: 'release', reason: 'not_found' });
  });
  it('no inquiry / unreachable: wait, then review after the factor — never decide the money', () => {
    expect(decideRecovery({ kind: 'no_inquiry' }, { ageMs: 0 }).action).toBe('wait');
    expect(decideRecovery({ kind: 'no_inquiry' }, { ageMs: DEFAULT_STALE_MS * UNREACHABLE_REVIEW_FACTOR })).toMatchObject({ action: 'review', reason: 'no_inquiry' });
    expect(decideRecovery({ kind: 'unreachable', error: 'ECONNRESET' }, { ageMs: 1 }).action).toBe('wait');
    expect(decideRecovery({ kind: 'unreachable', error: 'ECONNRESET' }, { ageMs: DEFAULT_STALE_MS * UNREACHABLE_REVIEW_FACTOR })).toMatchObject({ action: 'review', reason: 'unreachable' });
  });
});

describe('MobileAttemptRecoveryWorker', () => {
  async function seed() {
    const attempts = new InMemoryMobilePaymentAttemptRepository();
    for (const [k, st] of [['U1', 'unknown'], ['U2', 'timed_out'], ['R1', 'ready'], ['C1', 'confirmed']] as const) {
      await attempts.createOrGet(ctx, { ticketId: 'tk', amountCents: 100, idempotencyKey: k });
      if (st === 'unknown') { await attempts.updateStatus('T1', k, 'readiness_checking'); await attempts.updateStatus('T1', k, 'ready'); await attempts.updateStatus('T1', k, 'reader_initializing'); await attempts.updateStatus('T1', k, 'awaiting_customer_tap'); await attempts.updateStatus('T1', k, 'card_detected'); await attempts.updateStatus('T1', k, 'authorization_pending'); await attempts.updateStatus('T1', k, 'unknown'); }
      if (st === 'timed_out') { await attempts.updateStatus('T1', k, 'readiness_checking'); await attempts.updateStatus('T1', k, 'ready'); await attempts.updateStatus('T1', k, 'reader_initializing'); await attempts.updateStatus('T1', k, 'awaiting_customer_tap'); await attempts.updateStatus('T1', k, 'timed_out'); }
      if (st === 'ready') { await attempts.updateStatus('T1', k, 'readiness_checking'); await attempts.updateStatus('T1', k, 'ready'); }
      if (st === 'confirmed') { await attempts.updateStatus('T1', k, 'readiness_checking'); await attempts.updateStatus('T1', k, 'ready'); await attempts.updateStatus('T1', k, 'reader_initializing'); await attempts.updateStatus('T1', k, 'awaiting_customer_tap'); await attempts.updateStatus('T1', k, 'card_detected'); await attempts.updateStatus('T1', k, 'authorization_pending'); await attempts.updateStatus('T1', k, 'authorized'); await attempts.updateStatus('T1', k, 'confirmation_pending'); await attempts.updateStatus('T1', k, 'confirmed'); }
    }
    return attempts;
  }

  it('verifies only the UNRESOLVED attempts, under each attempt\'s own tenant, and counts the decisions', async () => {
    const attempts = await seed();
    const seen: string[] = [];
    const verifier = { verifyAttempt: vi.fn(async (c: Ctx, k: string) => { seen.push(`${c.tenantId}:${k}`); return k === 'U1' ? { status: 'confirmed', decision: { action: 'confirm' as const, processorRef: 'R' } } : { status: 'timed_out', decision: { action: 'wait' as const, reason: 'x' } }; }) };
    const alerts = { raise: vi.fn() };
    const w = new MobileAttemptRecoveryWorker(attempts, verifier, alerts, { staleMs: 0, now: () => new Date(Date.now() + 1000) });
    const r = await w.run();
    expect(seen.sort()).toEqual(['T1:U1', 'T1:U2']);   // ready / confirmed are never "verified"
    expect(r).toMatchObject({ checked: 2, confirmed: 1, waiting: 1, review: 0, errors: 0 });
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('a review decision parks the attempt in reconciliation_required and raises the alert — once per tick, and the money is never touched', async () => {
    const attempts = await seed();
    const verifier = { verifyAttempt: vi.fn(async () => ({ status: 'unknown', decision: { action: 'review' as const, reason: 'no_inquiry' as const, detail: 'no lookup' } })) };
    const alerts = { raise: vi.fn() };
    const w = new MobileAttemptRecoveryWorker(attempts, verifier, alerts, { staleMs: 0, now: () => new Date(Date.now() + 1000) });
    const r = await w.run();
    expect(r.review).toBe(2);
    expect(alerts.raise).toHaveBeenCalledTimes(2);
    expect((await attempts.findByKey('T1', 'U1'))!.status).toBe('reconciliation_required');
    // the next tick: still unresolved, still asked (reconciliation_required is in the watched set), nothing decided
    const r2 = await w.run();
    expect(r2.checked).toBe(2);
  });

  it('a verifier error is counted and does not stop the other attempts', async () => {
    const attempts = await seed();
    const verifier = { verifyAttempt: vi.fn(async (_c: Ctx, k: string) => { if (k === 'U1') throw new Error('boom'); return { status: 'timed_out', decision: { action: 'wait' as const, reason: 'x' } }; }) };
    const w = new MobileAttemptRecoveryWorker(attempts, verifier, null, { staleMs: 0, now: () => new Date(Date.now() + 1000) });
    const r = await w.run();
    expect(r).toMatchObject({ checked: 2, errors: 1, waiting: 1 });
  });

  it('expires unused created / ready intents first (§132)', async () => {
    const attempts = new InMemoryMobilePaymentAttemptRepository();
    await attempts.createOrGet(ctx, { ticketId: 'tk', amountCents: 100, idempotencyKey: 'E1', expiresAt: new Date(Date.now() - 1).toISOString() });
    const w = new MobileAttemptRecoveryWorker(attempts, { verifyAttempt: vi.fn() }, null, { staleMs: 0 });
    expect((await w.run()).expired).toBe(1);
    expect((await attempts.findByKey('T1', 'E1'))!.status).toBe('canceled');
  });
});
