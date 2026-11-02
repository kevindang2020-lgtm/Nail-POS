// tech-assignment-reason.vitest.spec.ts — §13 derived "why you were assigned" reason (pure).
import { describe, it, expect } from 'vitest';
import { deriveAssignmentReason } from './tech.repository';

describe('deriveAssignmentReason (§13)', () => {
  it('prefers the customer-preferred-technician signal when the assigned tech matches', () => {
    expect(deriveAssignmentReason({ preferredTechId: 'tA', assignedTechId: 'tA', appointmentId: 'ap1', source: 'walk_in' }))
      .toBe('Customer’s preferred technician');
  });
  it('falls back to a booked appointment', () => {
    expect(deriveAssignmentReason({ preferredTechId: 'tA', assignedTechId: 'tB', appointmentId: 'ap1', source: 'queue' }))
      .toBe('Booked appointment');
  });
  it('maps known walk-in / check-in / rotation sources', () => {
    expect(deriveAssignmentReason({ source: 'walk_in' })).toBe('Walk-in — assigned at the front desk');
    expect(deriveAssignmentReason({ source: 'check_in' })).toBe('From check-in');
    expect(deriveAssignmentReason({ source: 'tech_queue' })).toBe('Next in rotation');
  });
  it('returns null when no signal applies (UI omits the line rather than guessing)', () => {
    expect(deriveAssignmentReason({ source: 'mystery' })).toBeNull();
    expect(deriveAssignmentReason({})).toBeNull();
  });
});

import { toStringArray } from './tech.repository';
describe('toStringArray (allergies coercion)', () => {
  it('handles arrays, JSON strings, plain strings, and empties', () => {
    expect(toStringArray(['Latex', ' Acetone '])).toEqual(['Latex', 'Acetone']);
    expect(toStringArray('["Latex","Gel"]')).toEqual(['Latex', 'Gel']);
    expect(toStringArray('Latex')).toEqual(['Latex']);
    expect(toStringArray([])).toBeNull();
    expect(toStringArray(null)).toBeNull();
    expect(toStringArray('')).toBeNull();
  });
});
