import { describe, it, expect, beforeEach } from 'vitest';
import { ProductImportService } from './product-import.service';
import { InMemoryImportRepo } from './product-import.repository';

describe('ProductImportService', () => {
  let svc: ProductImportService;
  beforeEach(() => { svc = new ProductImportService(new InMemoryImportRepo()); });

  const rows = [
    { name: 'Cuticle Oil', categoryName: 'Nail Care', sku: 'CND-CO-15', priceCents: 899 },
    { name: '', categoryName: 'Nail Care' },                    // missing_required_field
    { name: 'BadPrice', categoryName: 'Tools', priceCents: -5 }, // invalid_price
  ];

  it('stages an import, records the error queue, and does not import on create', async () => {
    const res = await svc.createImport({ filename: 'vendor.csv', rows });
    expect(res.ok).toBe(true);
    expect(res.job!.totalRows).toBe(3);
    expect(res.job!.validRows).toBe(1);
    expect(res.job!.invalidRows).toBe(2);
    expect(res.job!.importedRows).toBe(0);       // nothing imported until approval
    const errs = await svc.listErrors({});
    expect(errs.map((e) => e.errorType).sort()).toEqual(['invalid_price', 'missing_required_field']);
    expect(await svc.openErrorCount()).toBe(2);
  });

  it('approves an import → valid rows imported, invalid held (partially_imported), idempotent', async () => {
    const c = await svc.createImport({ filename: 'v.csv', rows });
    const a1 = await svc.approveImport(c.job!.id);
    expect(a1.ok).toBe(true);
    expect(a1.job!.status).toBe('partially_imported');
    expect(a1.job!.importedRows).toBe(1);
    expect(a1.job!.failedRows).toBe(2);
    const a2 = await svc.approveImport(c.job!.id);   // idempotent — no double import
    expect(a2.job!.importedRows).toBe(1);
  });

  it('is idempotent on re-submission with the same idempotency key', async () => {
    const first = await svc.createImport({ filename: 'v.csv', rows, idempotencyKey: 'batch-42' });
    const second = await svc.createImport({ filename: 'v.csv', rows, idempotencyKey: 'batch-42' });
    expect(second.deduped).toBe(true);
    expect(second.job!.id).toBe(first.job!.id);
    expect((await svc.listJobs({})).length).toBe(1);
  });

  it('retries only technically-retryable errors', async () => {
    await svc.createImport({ filename: 'v.csv', rows });
    const errs = await svc.listErrors({});
    const retryable = errs.find((e) => e.retryable)!;
    const r = await svc.retryError(retryable.id);
    expect(r.ok).toBe(true);
    expect(r.error!.status).toBe('resolved');
  });
});
