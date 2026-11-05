// mobile-branch-switch.vitest.spec.ts — Owner & Manager Payment App mandate §120: "Owner with multiple locations can switch
// branch. But: active payment must finish/cancel before switching." The switch itself is the platform's ONE branch switch
// (POST /auth/select-branch, identity BranchSelectionService — §121 allowed branches); this module answers the question that
// switch asks before re-scoping the session: is a payment ACTIVE for this person / this phone in the current branch?
//   active = an unreleased, unexpired MOBILE claim held by this user or this device, or a Tap to Pay attempt on this device
//   that is created (unexpired) / in flight / unresolved.
import { describe, it, expect, vi } from 'vitest';
import { InMemoryCheckoutRepository } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { InMemoryCheckoutLockRepository } from '../checkout-lock/checkout-lock.repository';
import { BRANCH_SWITCH_BLOCKING_STATES } from './payment-attempt-state';
import type { Ctx } from '@aipowersalon/permissions';

const T = 'luxe001'; const B = 'br_cherryhill'; const B2 = 'br_merchantville'; const TK = 'tk_2042'; const DEVICE = 'iphone-kevin-01';
const NOW = new Date('2026-10-13T15:00:00.000Z');   // fixed clock — no date-dependent tests
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ tenantId: T, branchId: B, userId: 'u_owner', role: 'OWNER', permissions: ['pos.devices.manage'], ...over });

function world() {
  const repo = new InMemoryCheckoutRepository();
  const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn() };
  const checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime);
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  const locks = new CheckoutLockService(new InMemoryCheckoutLockRepository());
  const gateways: any = { resolve: async () => ({ status: 'active', configured: true, merchantAccountId: null }) };
  const svc = new MobileCheckoutService({} as any, gateways, checkout, locks, attempts, new InMemoryTtpOnboardingStore(), new InMemoryMobilePayDeviceStore(), undefined, undefined, { realtime, now: () => NOW });
  return { svc, attempts, locks };
}
const who = (over: Partial<{ tenantId: string; branchId: string | null; userId: string; deviceId: string | null }> = {}) => ({ tenantId: T, branchId: B, userId: 'u_owner', deviceId: DEVICE, ...over });

describe('§120 branch switch — refused while a payment on this phone is active', () => {
  it('nothing active → the switch may go ahead (null)', async () => {
    const { svc } = world();
    expect(await svc.branchSwitchBlock(who())).toBeNull();
  });

  it('a claimed checkout on THIS phone blocks the switch with PAYMENT_IN_PROGRESS + "finish or cancel"', async () => {
    const { svc, locks } = world();
    await locks.acquire({ tenantId: T, branchId: B, ticketId: TK, userId: 'u_owner', deviceId: DEVICE, sessionId: 'S1', source: 'mobile' }, NOW);
    const b = await svc.branchSwitchBlock(who());
    expect(b).toMatchObject({ code: 'PAYMENT_IN_PROGRESS', kind: 'claim', ticketId: TK });
    expect(b!.message).toMatch(/finish or cancel/i);
  });

  it('the same person’s claim blocks even when the caller names no device (cannot be bypassed by omitting deviceId)', async () => {
    const { svc, locks } = world();
    await locks.acquire({ tenantId: T, branchId: B, ticketId: TK, userId: 'u_owner', deviceId: 'other-phone', sessionId: 'S1', source: 'mobile' }, NOW);
    expect(await svc.branchSwitchBlock(who({ deviceId: null }))).toMatchObject({ code: 'PAYMENT_IN_PROGRESS', kind: 'claim' });
  });

  it('a released claim, an expired claim, another person’s claim, a POS claim and another branch’s claim do not block', async () => {
    const { svc, locks } = world();
    await locks.acquire({ tenantId: T, branchId: B, ticketId: TK, userId: 'u_owner', deviceId: DEVICE, sessionId: 'S1', source: 'mobile' }, NOW);
    await locks.release(T, TK, 'S1');
    await locks.acquire({ tenantId: T, branchId: B, ticketId: 'tk_old', userId: 'u_owner', deviceId: DEVICE, sessionId: 'S0', source: 'mobile' }, new Date(NOW.getTime() - 10 * 60_000));   // expired long ago
    await locks.acquire({ tenantId: T, branchId: B, ticketId: 'tk_b', userId: 'u_mgr', deviceId: 'mgr-phone', sessionId: 'S2', source: 'mobile' }, NOW);
    await locks.acquire({ tenantId: T, branchId: B, ticketId: 'tk_pos', userId: 'u_owner', sessionId: 'S3', source: 'pos' }, NOW);
    await locks.acquire({ tenantId: T, branchId: B2, ticketId: 'tk_other_branch', userId: 'u_owner', deviceId: DEVICE, sessionId: 'S4', source: 'mobile' }, NOW);
    expect(await svc.branchSwitchBlock(who())).toBeNull();
  });

  it('an unresolved / in-flight Tap to Pay attempt on this phone blocks; a finished or canceled one does not', async () => {
    const { svc, attempts } = world();
    const c = ctx();
    await attempts.createOrGet(c, { ticketId: TK, amountCents: 4500, idempotencyKey: 'k1', deviceId: DEVICE, expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString() });
    await attempts.updateStatus(T, 'k1', 'unknown');
    expect(await svc.branchSwitchBlock(who())).toMatchObject({ code: 'PAYMENT_IN_PROGRESS', kind: 'attempt', ticketId: TK });
    await attempts.updateStatus(T, 'k1', 'canceled');
    expect(await svc.branchSwitchBlock(who())).toBeNull();
    await attempts.createOrGet(c, { ticketId: TK, amountCents: 4500, idempotencyKey: 'k2', deviceId: DEVICE });
    await attempts.updateStatus(T, 'k2', 'confirmed');
    expect(await svc.branchSwitchBlock(who())).toBeNull();
  });

  it('a fresh created intent blocks; one past its §132 expiry does not; another phone’s attempt does not', async () => {
    const { svc, attempts } = world();
    await attempts.createOrGet(ctx(), { ticketId: TK, amountCents: 100, idempotencyKey: 'old', deviceId: DEVICE, expiresAt: new Date(NOW.getTime() - 60_000).toISOString() });
    await attempts.createOrGet(ctx(), { ticketId: TK, amountCents: 100, idempotencyKey: 'mgr', deviceId: 'mgr-phone', expiresAt: new Date(NOW.getTime() + 60_000).toISOString() });
    expect(await svc.branchSwitchBlock(who())).toBeNull();
    await attempts.createOrGet(ctx(), { ticketId: TK, amountCents: 100, idempotencyKey: 'new', deviceId: DEVICE, expiresAt: new Date(NOW.getTime() + 60_000).toISOString() });
    expect(await svc.branchSwitchBlock(who())).toMatchObject({ kind: 'attempt' });
  });

  it('a session with no branch yet (first selection after sign-in) has nothing to finish', async () => {
    const { svc, locks } = world();
    await locks.acquire({ tenantId: T, branchId: B, ticketId: TK, userId: 'u_owner', deviceId: DEVICE, sessionId: 'S1', source: 'mobile' }, NOW);
    expect(await svc.branchSwitchBlock(who({ branchId: null }))).toBeNull();
  });

  it('the blocking states are exactly created + the in-flight/unresolved set (never a terminal or retryable state)', () => {
    expect([...BRANCH_SWITCH_BLOCKING_STATES].sort()).toEqual(['authorization_pending', 'authorized', 'awaiting_customer_tap', 'card_detected', 'confirmation_pending', 'created', 'reader_initializing', 'readiness_checking', 'ready', 'reconciliation_required', 'timed_out', 'unknown'].sort());
  });
});

describe('§120 wiring — the checkout module answers the identity branch switch', () => {
  it('MobileCheckoutModule provides BRANCH_SWITCH_GUARD (the token POST /auth/select-branch looks up) backed by branchSwitchBlock', async () => {
    const { MobileCheckoutModule, BRANCH_SWITCH_GUARD_TOKEN } = await import('./mobile-checkout.module');
    expect(BRANCH_SWITCH_GUARD_TOKEN).toBe('BRANCH_SWITCH_GUARD');   // = modules/identity auth/branch-switch-guard.ts BRANCH_SWITCH_GUARD
    const providers: any[] = Reflect.getMetadata('providers', MobileCheckoutModule) ?? [];
    const p = providers.find((x) => x && x.provide === BRANCH_SWITCH_GUARD_TOKEN);
    expect(p).toBeTruthy();
    const { svc, locks } = world();
    await locks.acquire({ tenantId: T, branchId: B, ticketId: TK, userId: 'u_owner', deviceId: DEVICE, sessionId: 'S1', source: 'mobile' }, NOW);
    const guard = p.useFactory(svc);
    const block = await guard.blockReason({ tenantId: T, branchId: B, userId: 'u_owner', deviceId: DEVICE, targetBranchId: B2 });
    expect(block).toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    expect(await guard.blockReason({ tenantId: T, branchId: B, userId: 'u_x', deviceId: 'x', targetBranchId: B2 })).toBeNull();
  });
});
