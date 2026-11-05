import { describe, it, expect, vi } from 'vitest';
import { CustomersService } from './customers.service';
import { InMemoryCustomersRepository } from './customers.repository';
import { LimitExceededError } from '@aipowersalon/platform';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.customers.create'] } as any;
const req = { firstName: 'Ada', phone: '5551234567' } as any;

describe('CustomersService — hard customer-limit enforcement', () => {
  it('blocks creation (propagates LimitExceededError) when the limit is reached', async () => {
    const entitlements = { assertCanCreate: vi.fn().mockRejectedValue(new LimitExceededError('Hard limit reached (5/5).')) } as any;
    const svc = new CustomersService(new InMemoryCustomersRepository(), undefined, entitlements);
    await expect(svc.create(ctx, req)).rejects.toBeInstanceOf(LimitExceededError);
    expect(entitlements.assertCanCreate).toHaveBeenCalledWith('t1', 'customers');
  });

  it('allows creation when under the limit, and is a no-op without an entitlements service', async () => {
    const entitlements = { assertCanCreate: vi.fn().mockResolvedValue(undefined) } as any;
    const withEnt = new CustomersService(new InMemoryCustomersRepository(), undefined, entitlements);
    expect(await withEnt.create(ctx, req)).toBeTruthy();
    expect(entitlements.assertCanCreate).toHaveBeenCalled();

    const noEnt = new CustomersService(new InMemoryCustomersRepository());
    expect(await noEnt.create(ctx, { firstName: 'Grace', phone: '5559876543' } as any)).toBeTruthy(); // unchanged behavior
  });
});
