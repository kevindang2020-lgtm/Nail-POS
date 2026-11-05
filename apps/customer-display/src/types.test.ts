import { describe, it, expect } from 'vitest';
import { usd } from './types';

// The kiosk renders only money the backend computed; usd is the single formatter, so lock its cents→dollars behavior.
describe('usd', () => {
  it('formats whole and fractional dollars with two decimals', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(5)).toBe('$0.05');
    expect(usd(1234)).toBe('$12.34');
  });

  it('adds thousands separators', () => {
    expect(usd(123456)).toBe('$1,234.56');
  });
});
