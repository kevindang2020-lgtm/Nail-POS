import { describe, it, expect } from 'vitest';
import { InMemoryGiftCardStockRepo } from './gift-card-stock.repository';
import { GiftCardStockService } from './gift-card-stock.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1' };
const svc = () => new GiftCardStockService(new InMemoryGiftCardStockRepo());

describe('GiftCardStockService', () => {
  it('registers a pasted batch of numbers (spacing-tolerant) and counts them', async () => {
    const s = svc();
    const res = await s.registerBatch(ctx, { numbers: '1111 2222 3333 4444\n5555666677778888\n9999000011112222', batchLabel: 'Box A' });
    expect(res.added).toBe(3);
    expect(res.invalid).toBe(0);
    const st = await s.getState(ctx);
    expect(st.counts.available).toBe(3);
    expect(st.counts.total).toBe(3);
  });

  it('flags low stock when available is under the threshold', async () => {
    const s = svc();
    await s.registerBatch(ctx, { numbers: '1111222233334444' });
    expect((await s.getState(ctx)).lowStock).toBe(true);
  });

  it('counts invalid tokens and rejects an all-invalid batch', async () => {
    const s = svc();
    const res = await s.registerBatch(ctx, { numbers: '1111222233334444\nnot-a-number\n12345' });
    expect(res.added).toBe(1);
    expect(res.invalid).toBe(2);
    await expect(s.registerBatch(ctx, { numbers: 'abc\n123' })).rejects.toThrow(/valid/i);
  });

  it('skips duplicates within the input and against existing stock', async () => {
    const s = svc();
    await s.registerBatch(ctx, { numbers: '1111222233334444' });
    const res = await s.registerBatch(ctx, { numbers: '1111222233334444\n5555666677778888\n5555666677778888' });
    expect(res.added).toBe(1);
    expect(res.duplicates).toBe(2);
  });

  it('voids an available card but refuses an unknown one', async () => {
    const s = svc();
    await s.registerBatch(ctx, { numbers: '1111222233334444' });
    const id = (await s.getState(ctx)).items[0].id;
    expect((await s.voidCard(ctx, id)).ok).toBe(true);
    expect((await s.getState(ctx)).counts.void).toBe(1);
    await expect(s.voidCard(ctx, 'nope')).rejects.toThrow(/not available/i);
  });
});
