import { describe, it, expect } from 'vitest';
import { approvalUrgency } from '../POSDealsScreen';

const now = Date.parse('2026-11-11T12:00:00Z');
describe('approvalUrgency', () => {
  it('flags proposals starting within 48 h or already past; nothing for later or open-ended', () => {
    expect(approvalUrgency('2026-11-12T00:30:00Z', now)).toEqual({ kind: 'soon', hours: 13 });
    expect(approvalUrgency('2026-11-11T11:00:00Z', now)).toEqual({ kind: 'passed', hours: 0 });
    expect(approvalUrgency('2026-11-20T12:00:00Z', now)).toBeNull();
    expect(approvalUrgency(null, now)).toBeNull();
  });
});
