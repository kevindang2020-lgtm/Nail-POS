// attempt-branch-scope.pgtest — SD-21 (Security Deep Scan §75 live run, Oct 27 2026): GET /mobile-checkout/payment-attempts/
// {idempotencyKey} answered another LOCATION's payment attempt (amount, status) to a manager of the same salon — the lookup
// was filtered by salon only. On the REAL payment_attempts table, through the real controller → service → Kysely repository:
// location 1's manager is served location 1's attempt; location 2's manager asking for that key gets 404 (the same answer as
// an unknown key), and location 2's own attempt is still served to them (the query is not simply broken).
import { describe, it, expect, beforeAll } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MobileCheckoutController } from './mobile-checkout.controller';
import { MobileCheckoutService } from './mobile-checkout.service';
import { KyselyMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';

const T = 'd2100000-0000-4000-8000-00000000000a';
const B1 = 'd2110000-0000-4000-8000-000000000001', B2 = 'd2110000-0000-4000-8000-000000000002';
let ctl: MobileCheckoutController; let repo: KyselyMobilePaymentAttemptRepository;
const req = (branchId: string) => ({ ctx: { tenantId: T, branchId, userId: 'd2120000-0000-4000-8000-000000000001', role: 'MANAGER', permissions: ['mobile_checkout.tap_to_pay'] } });

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'SD21', 'SD21', 'sd21', 'SD21', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B1}', '${T}', 'Location 1'), ('${B2}', '${T}', 'Location 2')`);
  for (const [b, key, cents] of [[B1, 'ttp_loc1', 4200], [B2, 'ttp_loc2', 1500]] as const) {
    await pg.query(`INSERT INTO payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key) VALUES ($1, $2, gen_random_uuid(), $3, 'tap_to_pay', 'created', $4)`, [T, b, cents, key]);
  }
  repo = new KyselyMobilePaymentAttemptRepository(kyselyFor(pg) as any);
  // getAttempt reads only the attempt port — the service's other collaborators are not part of this route
  const svc = Object.create(MobileCheckoutService.prototype) as MobileCheckoutService;
  (svc as any).attempts = repo;
  ctl = new MobileCheckoutController(svc);
}, 120_000);

const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; } };

describe('SD-21: a payment attempt is read only at its own location', () => {
  it('location 1\'s manager is served location 1\'s attempt (positive control)', async () => {
    const a: any = await ctl.getAttempt(req(B1), 'ttp_loc1');
    expect(a).toMatchObject({ idempotencyKey: 'ttp_loc1', amountCents: 4200 });
  });
  it('location 2\'s manager asking for location 1\'s key gets 404 — no amount, no status', async () => {
    expect(await status(ctl.getAttempt(req(B2), 'ttp_loc1'))).toBe(404);
  });
  it('location 2\'s manager is still served location 2\'s own attempt', async () => {
    const a: any = await ctl.getAttempt(req(B2), 'ttp_loc2');
    expect(a).toMatchObject({ idempotencyKey: 'ttp_loc2', amountCents: 1500 });
  });
  it('an unknown key is the same 404 (the refusal does not reveal that the key exists elsewhere)', async () => {
    expect(await status(ctl.getAttempt(req(B2), 'ttp_nope'))).toBe(404);
  });
  it('the repository predicate itself: salon-scoped findByKey still finds it (workers), the branch read does not', async () => {
    expect(await repo.findByKey(T, 'ttp_loc1')).not.toBeNull();
    expect(await repo.findByKeyInBranch({ tenantId: T, branchId: B2 } as any, 'ttp_loc1')).toBeNull();
    expect(await repo.findByKeyInBranch({ tenantId: T, branchId: B1 } as any, 'ttp_loc1')).not.toBeNull();
  });
});
