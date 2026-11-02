import { describe, it, expect } from 'vitest';
import { formatCents, maskedPhone, titleCase } from './format';

describe('formatCents', () => {
  it('formats integer cents as USD', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(3233)).toBe('$32.33');
    expect(formatCents(100000)).toBe('$1,000.00');
    expect(formatCents(-500)).toBe('-$5.00');
  });
  it('renders an em dash for missing values', () => {
    expect(formatCents(null)).toBe('—');
    expect(formatCents(undefined)).toBe('—');
    expect(formatCents(NaN)).toBe('—');
  });
});

describe('maskedPhone + titleCase', () => {
  it('masks a phone last-4 and dashes when absent', () => {
    expect(maskedPhone('1234')).toBe('•••• 1234');
    expect(maskedPhone(null)).toBe('—');
  });
  it('title-cases snake/lower statuses', () => {
    expect(titleCase('ready_for_payment')).toBe('Ready For Payment');
    expect(titleCase('in_service')).toBe('In Service');
    expect(titleCase(undefined)).toBe('—');
  });
});
