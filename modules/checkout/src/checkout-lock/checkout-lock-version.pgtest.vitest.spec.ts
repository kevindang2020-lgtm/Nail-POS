// checkout-lock-version.pgtest — Secure Tap to Pay M6-6 (§21 / §31 / §66) on the REAL migrated schema (690): a claim stores
// the checkout version it was made against; a heartbeat keeps it; a re-claim moves it; isClaimStale judges it.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCheckoutLockRepository } from './checkout-lock.repository';
import { CheckoutLockService } from './checkout-lock.service';
import { isClaimStale } from './checkout-lock-core';

let pg: any; let svc: CheckoutLockService; let repo: KyselyCheckoutLockRepository;
const T = 'd6900000-0000-4000-8000-00000000000a', B = 'd6901000-0000-4000-8000-00000000000a', U = 'd6902000-0000-4000-8000-00000000000a';
const TK = 'd6903000-0000-4000-8000-00000000000a';

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'D690', 'D690', 'd690', 'D690', 'active')`);
  repo = new KyselyCheckoutLockRepository(kyselyFor(pg)); svc = new CheckoutLockService(repo);
}, 120_000);

describe('checkout_locks.checkout_version (migration 690)', () => {
  it('claim at v7 → stored; heartbeat keeps v7; POS moves the ticket to v8 → stale; re-claim at v8 → current', async () => {
    await svc.acquire({ tenantId: T, branchId: B, ticketId: TK, userId: U, deviceId: 'ph', sessionId: 'S', source: 'mobile', checkoutVersion: 'v7' });
    expect((await repo.getActive(T, TK))!.checkoutVersion).toBe('v7');
    await svc.refresh(T, TK, 'S');
    const held = await repo.getActive(T, TK);
    expect(held!.checkoutVersion).toBe('v7');
    expect(isClaimStale(held, 'v7')).toBe(false);
    expect(isClaimStale(held, 'v8')).toBe(true);
    await svc.acquire({ tenantId: T, branchId: B, ticketId: TK, userId: U, deviceId: 'ph', sessionId: 'S', source: 'mobile', checkoutVersion: 'v8' });
    expect((await repo.getActive(T, TK))!.checkoutVersion).toBe('v8');
  });
  it('a lock with no version (POS / pre-690) is never stale', async () => {
    await svc.acquire({ tenantId: T, branchId: B, ticketId: 'd6903000-0000-4000-8000-0000000000bb', userId: U, sessionId: 'P', source: 'pos' });
    const pos = await repo.getActive(T, 'd6903000-0000-4000-8000-0000000000bb');
    expect(pos!.checkoutVersion).toBeNull();
    expect(isClaimStale(pos, 'anything')).toBe(false);
  });
});
