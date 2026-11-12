import { describe, it, expect } from 'vitest';
import { splitPreview } from './splitPreview';

describe('splitPreview', () => {
  it('groups by tender and shows what is still due', () => {
    expect(splitPreview([{ method: 'cash', amountStr: '20' }, { method: 'card', amountStr: '30.50' }, { method: 'card', amountStr: '10' }], 8000))
      .toEqual({ byMethod: [{ method: 'card', cents: 4050, count: 2 }, { method: 'cash', cents: 2000, count: 1 }], totalCents: 6050, remainingCents: 1950, invalid: 0, ok: false });
  });
  it('over-allocation is negative remaining; blank or bad amounts are counted, never guessed', () => {
    const p = splitPreview([{ method: 'gift_card', amountStr: '90' }, { method: 'cash', amountStr: '' }, { method: 'cash', amountStr: 'abc' }], 8000);
    expect(p).toMatchObject({ remainingCents: -1000, invalid: 2, ok: false });
  });
  it('exact total with valid amounts is ready', () => {
    expect(splitPreview([{ method: 'card', amountStr: '50' }, { method: 'cash', amountStr: '30' }], 8000).ok).toBe(true);
  });
});
