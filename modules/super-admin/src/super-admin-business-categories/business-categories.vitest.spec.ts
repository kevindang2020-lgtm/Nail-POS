import { describe, it, expect, beforeEach } from 'vitest';
import { slugify, validateCategoryName, nextSortOrder, applyReorder } from './business-category-core';
import { BusinessCategoriesService, BizCatError } from './business-categories.service';
import { InMemoryBizCategoriesRepo } from './business-categories.repository';

describe('business-category-core', () => {
  it('slugifies names', () => {
    expect(slugify('Nail Salon')).toBe('nail-salon');
    expect(slugify('  Full-Service Spa!! ')).toBe('full-service-spa');
    expect(slugify('!!!')).toBe('');
  });
  it('validates names', () => {
    expect(validateCategoryName('Spa')).toBeNull();
    expect(validateCategoryName('a')).toMatch(/at least 2/i);
    expect(validateCategoryName('<script>x')).toMatch(/script/i);
  });
  it('computes sort order + reorder', () => {
    expect(nextSortOrder([{ sortOrder: 10 }, { sortOrder: 30 }])).toBe(40);
    expect(nextSortOrder([])).toBe(10);
    expect(applyReorder(['a', 'b', 'c'])).toEqual([{ id: 'a', sortOrder: 10 }, { id: 'b', sortOrder: 20 }, { id: 'c', sortOrder: 30 }]);
  });
});

const CTX = { userId: 'sa-1', email: 'a@x.io', role: 'SUPER_ADMIN' };

describe('BusinessCategoriesService', () => {
  let svc: BusinessCategoriesService; let repo: InMemoryBizCategoriesRepo;
  beforeEach(() => { repo = new InMemoryBizCategoriesRepo(); svc = new BusinessCategoriesService(repo); });

  it('creates categories, rejecting invalid names + duplicates', async () => {
    const c = await svc.create(CTX, { name: 'Nail Salon' });
    expect(c.slug).toBe('nail-salon');
    expect(c.active).toBe(true);
    await expect(svc.create(CTX, { name: 'a' })).rejects.toThrow(/at least 2/i);
    await expect(svc.create(CTX, { name: 'Nail Salon' })).rejects.toThrow(/already exists/i);
    expect((await svc.summary())).toEqual({ active: 1, total: 1 });
  });

  it('renames without changing the slug (stable references)', async () => {
    const c = await svc.create(CTX, { name: 'Barbershop' });
    const r = await svc.rename(CTX, c.id, 'Barber Shop');
    expect(r.name).toBe('Barber Shop');
    expect(r.slug).toBe('barbershop'); // unchanged
  });

  it('activates/deactivates + reflects in summary', async () => {
    const c = await svc.create(CTX, { name: 'Spa' });
    await svc.setActive(CTX, c.id, false);
    expect(await svc.summary()).toEqual({ active: 0, total: 1 });
    expect((await svc.list(false)).length).toBe(0);
    expect((await svc.list(true)).length).toBe(1);
  });

  it('reorders, rejecting unknown ids', async () => {
    const a = await svc.create(CTX, { name: 'Alpha' });
    const b = await svc.create(CTX, { name: 'Beta' });
    await svc.reorder(CTX, [b.id, a.id]);
    const list = await svc.list(true);
    expect(list[0].id).toBe(b.id);
    await expect(svc.reorder(CTX, ['nope'])).rejects.toThrow(BizCatError);
  });
});
