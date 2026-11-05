import { describe, it, expect } from 'vitest';
import { ProductBarcodeService } from './product-barcode.service';
import { InMemoryBarcodeRepo } from './product-barcode.repository';

const svc = () => new ProductBarcodeService(new InMemoryBarcodeRepo({ masters: ['PM-0001', 'PM-0002'] }));

describe('ProductBarcodeService', () => {
  it('rejects an unknown master product', async () => {
    expect((await svc().addBarcode({ masterProductId: 'NOPE', barcode: '036000291452', reason: 'x' })).ok).toBe(false);
  });

  it('validates checksum and requires a reason', async () => {
    const s = svc();
    const bad = await s.addBarcode({ masterProductId: 'PM-0001', barcode: '036000291453', reason: '' });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain('Barcode check digit is invalid.');
    expect(bad.errors).toContain('A reason is required for barcode changes.');
  });

  it('adds a valid barcode with type classification and history', async () => {
    const s = svc();
    const r = await s.addBarcode({ masterProductId: 'PM-0001', barcode: '036000291452', reason: 'initial', isPrimary: true });
    expect(r.ok).toBe(true);
    expect(r.barcode!.barcodeType).toBe('upc_a');
    expect(r.barcode!.isPrimary).toBe(true);
    expect((await s.list('PM-0001'))).toHaveLength(1);
  });

  it('blocks silent reassignment of a barcode already active on another product', async () => {
    const s = svc();
    await s.addBarcode({ masterProductId: 'PM-0001', barcode: '036000291452', reason: 'a' });
    const conflict = await s.addBarcode({ masterProductId: 'PM-0002', barcode: '036000291452', reason: 'b' });
    expect(conflict.ok).toBe(false);
    expect(conflict.errors!.some((e) => e.includes('already active on another product'))).toBe(true);
  });

  it('retires the prior primary when a new primary is added (one active primary)', async () => {
    const s = svc();
    await s.addBarcode({ masterProductId: 'PM-0001', barcode: '036000291452', reason: 'first', isPrimary: true });
    await s.addBarcode({ masterProductId: 'PM-0001', barcode: '4006381333931', reason: 'second', isPrimary: true });
    const list = await s.list('PM-0001');
    expect(list.filter((b) => b.isPrimary)).toHaveLength(1);
  });
});
