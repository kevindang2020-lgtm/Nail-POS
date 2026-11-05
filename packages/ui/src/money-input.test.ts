// money-input.test.ts — the shared parser is the spec's "no floating-point money" guarantee; pin it exactly.
import { describe, it, expect } from 'vitest';
import { parseDollarsToCents, formatCentsUsd, keypadPress } from './money-input';

describe('parseDollarsToCents (exact, string-only)', () => {
  it('parses the spec examples exactly', () => {
    expect(parseDollarsToCents('5.00')).toBe(500);
    expect(parseDollarsToCents('10.00')).toBe(1000);
    expect(parseDollarsToCents('17.50')).toBe(1750);
    expect(parseDollarsToCents('25.00')).toBe(2500);
    expect(parseDollarsToCents('40.00')).toBe(4000);
    expect(parseDollarsToCents('100.00')).toBe(10000);
    expect(parseDollarsToCents('1')).toBe(100);
  });
  it('handles partial forms and the $ prefix without float math', () => {
    expect(parseDollarsToCents('0.07')).toBe(7);
    expect(parseDollarsToCents('.5')).toBe(50);
    expect(parseDollarsToCents('5.')).toBe(500);
    expect(parseDollarsToCents('$12.50')).toBe(1250);
  });
  it('rejects everything invalid: negatives, text, commas, 3 decimals, empty', () => {
    for (const bad of ['-3', 'abc', '1,000', '1.234', '', '.', '12a', '1.2.3', null, undefined]) {
      expect(parseDollarsToCents(bad as any)).toBeNull();
    }
  });
});

describe('formatCentsUsd', () => {
  it('renders cents without float arithmetic', () => {
    expect(formatCentsUsd(1750)).toBe('$17.50');
    expect(formatCentsUsd(7)).toBe('$0.07');
    expect(formatCentsUsd(0)).toBe('$0.00');
  });
});

describe('keypadPress', () => {
  it('builds 17.50 keystroke by keystroke, one dot max, two decimals max, backspace works', () => {
    let r = '';
    for (const k of ['1', '7', '.', '5', '0']) r = keypadPress(r, k);
    expect(r).toBe('17.50');
    expect(keypadPress(r, '9')).toBe('17.50');     // third decimal refused
    expect(keypadPress(r, '.')).toBe('17.50');     // second dot refused
    expect(keypadPress(r, '⌫')).toBe('17.5');
    expect(keypadPress('', '.')).toBe('0.');
  });
});
