import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileCheckoutService, AttemptError } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import type { Ctx } from '@aipowersalon/permissions';

const ctx: Ctx = { tenantId: 'T1', branchId: 'B1', userId: 'u_mgr', role: 'MANAGER', permissions: [] };

async function setup(startStatus: string, tapToPayConfigured = true) {
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  await attempts.createOrGet(ctx, { ticketId: 'tk1', amountCents: 3233, idempotencyKey: 'K1' });
  if (startStatus !== 'created') await attempts.updateStatus(ctx.tenantId, 'K1', startStatus as any);
  // Secure Tap to Pay §29: an approval is recorded only after the PROVIDER confirms it — a configured fake provider here
  const ttp: any = { provider: 'fake', isConfigured: () => tapToPayConfigured, finalizeTransaction: async (a: any) => ({ verified: true, processorRef: a.processorRef, capturedAmountCents: undefined }) };
  const svc = new MobileCheckoutService(undefined as any, {} as any, {} as any, undefined as any, attempts, undefined, undefined, ttp);
  vi.spyOn(svc as any, 'getReadiness').mockResolvedValue({ overall: tapToPayConfigured ? 'ready' : 'tap_to_pay_setup_required', canTakePayment: tapToPayConfigured, generatedAt: '', checks: [{ key: 'tap_to_pay', label: 'Tap to Pay', critical: true, state: tapToPayConfigured ? 'ok' : 'setup_required' }] });
  return { svc, attempts };
}

describe('applyCaptureResult (§5 bridge) — safety + lifecycle', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('REFUSES to record a capture when Tap to Pay is not configured (no fabricated confirm)', async () => {
    const { svc, attempts } = await setup('ready', /* configured */ false);
    await expect(svc.applyCaptureResult(ctx, 'K1', { outcome: 'approved' })).rejects.toThrow(/not configured/i);
    // the attempt did NOT advance
    expect((await attempts.findByKey('T1', 'K1'))!.status).toBe('ready');
  });

  it('advances an approved capture to confirmed when the rail is configured', async () => {
    const { svc, attempts } = await setup('ready', true);
    const res = await svc.applyCaptureResult(ctx, 'K1', { outcome: 'approved', processorRef: 'PR1' });
    expect(res).toMatchObject({ from: 'ready', to: 'confirmed', outcome: 'approved' });
    expect((await attempts.findByKey('T1', 'K1'))!.status).toBe('confirmed');
  });

  it('records decline / timeout / unknown outcomes', async () => {
    for (const [outcome, end] of [['declined', 'declined'], ['timeout', 'timed_out'], ['unknown', 'unknown']] as const) {
      const { svc } = await setup('ready', true);
      const res = await svc.applyCaptureResult(ctx, 'K1', { outcome });
      expect(res.to).toBe(end);
    }
  });

  it('reconciles an unknown result once settlement is known', async () => {
    const { svc, attempts } = await setup('unknown', true);
    const res = await svc.reconcileAttempt(ctx, 'K1', 'confirmed');
    expect(res).toMatchObject({ from: 'unknown', to: 'confirmed', resolution: 'confirmed' });
    expect((await attempts.findByKey('T1', 'K1'))!.status).toBe('confirmed');
  });

  it('rejects a result on a terminal attempt and on an unknown key; a repeated callback on a CONFIRMED attempt replays (§67: one charge)', async () => {
    const { svc } = await setup('voided', true);
    await expect(svc.applyCaptureResult(ctx, 'K1', { outcome: 'approved' })).rejects.toBeInstanceOf(AttemptError);
    const { svc: svcC } = await setup('confirmed', true);
    expect(await svcC.applyCaptureResult(ctx, 'K1', { outcome: 'approved' })).toMatchObject({ from: 'confirmed', to: 'confirmed', outcome: 'approved' });
    const { svc: svc2 } = await setup('ready', true);
    await expect(svc2.applyCaptureResult(ctx, 'NOPE', { outcome: 'approved' })).rejects.toThrow(/not found/i);
  });

  it('rejects an out-of-window capture result (invalid state)', async () => {
    const { svc } = await setup('created', true); // not yet ready
    await expect(svc.applyCaptureResult(ctx, 'K1', { outcome: 'approved' })).rejects.toThrow(/cannot go from|invalid/i);
  });
});
