import { describe, it, expect } from 'vitest';
import { canSubmit, buildManifest, cleanItems, outcomeToStatus, outcomeRequiresOverride, type EvidenceItem } from './disputes-actions-core';

const now = new Date('2026-05-06T12:00:00Z').getTime();
const ev = (o: Partial<EvidenceItem>): EvidenceItem => ({ id: 'e', scanStatus: 'clean', reviewStatus: 'uploaded', fileHash: 'h', evidenceType: 'service_record', ...o });

describe('canSubmit', () => {
  it('allows submission when status is eligible, deadline is future, and clean evidence exists', () => {
    expect(canSubmit({ status: 'evidence_collecting', dueBy: '2026-05-10T00:00:00Z' }, [ev({})], now).ok).toBe(true);
  });
  it('blocks when status is not submittable', () => {
    const r = canSubmit({ status: 'won', dueBy: '2026-05-10T00:00:00Z' }, [ev({})], now);
    expect(r.ok).toBe(false); expect(r.error).toMatch(/not eligible/);
  });
  it('blocks when the deadline has passed', () => {
    const r = canSubmit({ status: 'open', dueBy: '2026-05-01T00:00:00Z' }, [ev({})], now);
    expect(r.ok).toBe(false); expect(r.error).toMatch(/deadline has passed/);
  });
  it('blocks when there is no clean, non-rejected evidence', () => {
    expect(canSubmit({ status: 'open', dueBy: null }, [], now).ok).toBe(false);
    expect(canSubmit({ status: 'open', dueBy: null }, [ev({ scanStatus: 'pending' })], now).ok).toBe(false);
    expect(canSubmit({ status: 'open', dueBy: null }, [ev({ reviewStatus: 'rejected' })], now).ok).toBe(false);
  });
});

describe('buildManifest', () => {
  it('includes only clean, non-rejected items with ids + hashes (no contents)', () => {
    const m = buildManifest([ev({ id: 'a' }), ev({ id: 'b', scanStatus: 'pending' }), ev({ id: 'c', reviewStatus: 'rejected' })]);
    expect(m.count).toBe(1);
    expect(m.items[0]).toMatchObject({ id: 'a', hash: 'h' });
    expect(JSON.stringify(m)).not.toContain('contents');
  });
  it('cleanItems filters as expected', () => {
    expect(cleanItems([ev({ id: 'a' }), ev({ id: 'b', scanStatus: 'infected' })]).map((x) => x.id)).toEqual(['a']);
  });
});

describe('outcomeToStatus', () => {
  it('maps outcomes to lifecycle statuses', () => {
    expect(outcomeToStatus('won')).toBe('won');
    expect(outcomeToStatus('partially_won')).toBe('won');
    expect(outcomeToStatus('lost')).toBe('lost');
    expect(outcomeToStatus('withdrawn')).toBe('withdrawn');
    expect(outcomeToStatus('reopened')).toBe('reopened');
  });
});

describe('outcomeRequiresOverride', () => {
  it('is an override to mark won/lost when the processor has not authoritatively decided', () => {
    expect(outcomeRequiresOverride('none', 'won')).toBe(true);
    expect(outcomeRequiresOverride('under_review', 'lost')).toBe(true);
  });
  it('is NOT an override when the processor already decided', () => {
    expect(outcomeRequiresOverride('won', 'won')).toBe(false);
    expect(outcomeRequiresOverride('lost', 'lost')).toBe(false);
  });
  it('is NOT an override for non-decisive lifecycle outcomes', () => {
    expect(outcomeRequiresOverride('none', 'withdrawn')).toBe(false);
    expect(outcomeRequiresOverride('none', 'reopened')).toBe(false);
  });
});
