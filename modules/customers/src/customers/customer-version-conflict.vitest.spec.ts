// customer-version-conflict.vitest.spec.ts — Smooth Refresh spec §14–§16/§105: two employees editing the same customer
// must never silently lose data. An edit based on an older copy is refused with VERSION_CONFLICT; the newer change stays.
import { describe, it, expect } from 'vitest';
import { CustomersService } from './customers.service';
import { InMemoryCustomersRepository } from './customers.repository';
import { CustomerVersionConflict } from './customers.dto';

const ctx = { tenantId: 't_A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.customers.view', 'pos.customers.edit', 'pos.customers.create'] } as any;

const seed = (svc: CustomersService) => svc.create(ctx, { firstName: 'Ana', lastName: 'Lee', phone: '+15555550142', email: 'ana@example.com' } as any);

describe('customer profile optimistic concurrency (spec §14–§16)', () => {
  it('rows carry a version; each edit bumps it', async () => {
    const svc = new CustomersService(new InMemoryCustomersRepository());
    const first = await seed(svc);
    expect(first.version).toBe(1);
    const edited = await svc.update(ctx, first.customerId, { email: 'a@example.com', expectedVersion: 1 });
    expect(edited.version).toBe(2);
  });

  it('POS A and POS B both open version 1; A saves; B\'s save is refused with VERSION_CONFLICT and A\'s change survives', async () => {
    const svc = new CustomersService(new InMemoryCustomersRepository());
    const c = await seed(svc);
    await svc.update(ctx, c.customerId, { email: 'from-A@example.com', expectedVersion: 1 });
    const err = await svc.update(ctx, c.customerId, { email: 'from-B@example.com', expectedVersion: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(CustomerVersionConflict);
    expect(err.code).toBe('VERSION_CONFLICT');
    expect(err.currentVersion).toBe(2);
    expect((await svc.getState(ctx, {})).customers.items.find((x: any) => x.customerId === c.customerId)!.email).toBe('from-A@example.com');
  });

  it('an edit without expectedVersion still works (older clients) — the check is opt-in per request', async () => {
    const svc = new CustomersService(new InMemoryCustomersRepository());
    const c = await seed(svc);
    const r = await svc.update(ctx, c.customerId, { email: 'legacy@example.com' });
    expect(r.email).toBe('legacy@example.com');
  });
});
