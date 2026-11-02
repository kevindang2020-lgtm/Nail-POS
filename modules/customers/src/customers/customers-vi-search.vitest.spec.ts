// customers-vi-search — Vietnamese POS mandate WP-E (§41): the customer list search is accent-insensitive through the
// shared foldVi() (the kysely repository filters with the same expression; the SQL twin is proven in
// apps/api/src/pos/vi-search.pgtest.vitest.spec.ts). Tenant isolation is unchanged.
import { describe, it, expect } from 'vitest';
import { InMemoryCustomersRepository, type CustomersContext } from './customers.repository';

const ctx = (tenantId: string): CustomersContext => ({ tenantId, branchId: 'br_vi', userId: 'u1', role: 'OWNER', permissions: [] });

describe('customer list search — accent-insensitive Vietnamese', () => {
  it('"nguyen" finds Nguyễn, "dang" finds Đặng, accented queries still work, other tenants never appear', async () => {
    const repo = new InMemoryCustomersRepository();
    const A = ctx('vi_tenant_a'), Z = ctx('vi_tenant_z');
    await repo.create(A, { firstName: 'Hương', lastName: 'Nguyễn Thị', phone: '+16095550101' });
    await repo.create(A, { firstName: 'Tuấn', lastName: 'Đặng Minh', phone: '+16095550102' });
    await repo.create(Z, { firstName: 'Khác', lastName: 'Nguyễn Văn', phone: '+16095550103' });
    const names = async (c: CustomersContext, search: string) => ((await repo.query(c, { search })) as any).rows?.items ?? (await repo.query(c, { search }) as any).items;
    const last = async (c: CustomersContext, s: string) => (await names(c, s)).map((r: any) => r.lastName);
    expect(await last(A, 'nguyen')).toEqual(['Nguyễn Thị']);
    expect(await last(A, 'NGUYEN THI')).toEqual(['Nguyễn Thị']);
    expect(await last(A, 'dang')).toEqual(['Đặng Minh']);
    expect(await last(A, 'Đặng')).toEqual(['Đặng Minh']);
    expect(await last(A, 'huong')).toEqual(['Nguyễn Thị']);
    expect(await last(Z, 'nguyen')).toEqual(['Nguyễn Văn']);
    expect(await last(Z, 'dang')).toEqual([]);
  });
});
