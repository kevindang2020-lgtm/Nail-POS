// category-name-unique.vitest.spec.ts — D3 Service Categories guide (Nov 3 2026): two categories with the same name in one
// location split the menu and the reports. Create and rename refuse a clash (case and spaces ignored), 409
// CATEGORY_NAME_DUPLICATE; a merged category (history only) does not block the name; renaming a category to its own name is fine.
import { describe, it, expect } from 'vitest';
import { ServicesService } from './services.service';
import { InMemoryServicesRepository } from './services.repository';

const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.services.edit', 'pos.services.view'] };

describe('category names are unique per location', () => {
  it('create and rename refuse a clash; the same category keeps its name; a merged one does not block', async () => {
    const repo = new InMemoryServicesRepository();
    const svc = new ServicesService(repo as any);
    const a = await svc.createCategory(ctx, 'Pedicure');
    await expect(svc.createCategory(ctx, '  pedicure ')).rejects.toMatchObject({ apiCode: 'CATEGORY_NAME_DUPLICATE', status: 409 });
    const b = await svc.createCategory(ctx, 'Manicure');
    await expect(svc.updateCategory(ctx, b.categoryId, { name: 'PEDICURE' })).rejects.toMatchObject({ apiCode: 'CATEGORY_NAME_DUPLICATE' });
    expect((await svc.updateCategory(ctx, a.categoryId, { name: 'Pedicure ' })).name).toBe('Pedicure');
    await repo.updateCategory(ctx, a.categoryId, { status: 'merged' as any });
    expect((await svc.createCategory(ctx, 'Pedicure')).name).toBe('Pedicure');
  });
});
