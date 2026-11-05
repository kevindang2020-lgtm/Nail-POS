import { describe, it, expect, beforeEach } from 'vitest';
import { MasterProductService } from './product-master.service';
import { InMemoryMasterProductRepo } from './product-master.repository';

describe('MasterProductService', () => {
  let svc: MasterProductService;
  beforeEach(() => { svc = new MasterProductService(new InMemoryMasterProductRepo()); });

  it('rejects invalid input with field errors', async () => {
    const res = await svc.create({ name: '', categoryName: '' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors && res.errors.length).toBeTruthy();
  });

  it('creates a valid master product as draft', async () => {
    const res = await svc.create({ name: 'Cuticle Oil', categoryName: 'Nail Care', sku: 'CND-CO-15', costCents: 320, suggestedRetailCents: 899 });
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.product.status).toBe('draft'); expect(res.product.normalizedSku).toBe('CND-CO-15'); }
  });

  it('blocks a duplicate product code', async () => {
    await svc.create({ name: 'A', categoryName: 'Nail Care', code: 'ABC-1' });
    const dup = await svc.create({ name: 'B', categoryName: 'Nail Care', code: 'ABC-1' });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors).toContain('A product with this code already exists.');
  });

  it('gates on duplicate SKU candidates until confirmed', async () => {
    await svc.create({ name: 'Cuticle Oil', categoryName: 'Nail Care', sku: 'CND-CO-15' });
    const gated = await svc.create({ name: 'Cuticle Oil 2', categoryName: 'Nail Care', sku: 'cnd-co-15' });
    expect(gated.ok).toBe(false);
    if (!gated.ok) { expect(gated.requiresConfirmation).toBe(true); expect(gated.candidates?.[0].reason).toBe('exact_sku'); }

    const confirmed = await svc.create({ name: 'Cuticle Oil 2', categoryName: 'Nail Care', sku: 'cnd-co-15', confirmDuplicates: true });
    expect(confirmed.ok).toBe(true);
  });

  it('retires a product (preserving it) and requires a reason', async () => {
    const created = await svc.create({ name: 'X', categoryName: 'Nail Care' });
    const id = created.ok ? created.product.id : '';
    expect((await svc.retire(id, '')).ok).toBe(false);           // reason required
    const r = await svc.retire(id, 'discontinued by brand');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.product!.status).toBe('retired');
    const list = await svc.list({ status: 'retired' });
    expect(list.some((p) => p.id === id)).toBe(true);            // still present, not deleted
  });
});
