// tech-money.test.ts — wave 4 pilot P3: the Tech App showed "Adjustments $-6.75" (sign after the symbol). Money goes
// through the shared formatter, which writes a negative amount sign-first: "−$6.75".
import { describe, it, expect } from 'vitest';
import { money2 } from './tech';
describe('money2 (Tech App money)', () => {
  it('a negative adjustment reads −$6.75, never $-6.75', () => {
    expect(money2(-675)).toBe('−$6.75');
    expect(money2(675)).toBe('$6.75');
    expect(money2(null)).toBe('$0.00');
  });
});
