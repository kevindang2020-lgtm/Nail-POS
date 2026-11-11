// SUNMI batch 9 guide 8 (Nov 10 2026): the pay-period list — newest first, search, status, overlapping From–To range
import { describe, it, expect } from 'vitest';
import { filterPeriods } from './POSPayrollScreen';

const P = (id: string, label: string | null, s: string, e: string, status: 'draft' | 'review' | 'finalized' | 'paid') => ({ id, label, periodStart: s, periodEnd: e, status });
const rows = [P('a', 'Oct 1–15', '2026-10-01', '2026-10-15', 'paid'), P('c', null, '2026-11-01', '2026-11-15', 'draft'), P('b', 'Oct 16–31', '2026-10-16', '2026-10-31', 'finalized')];
const txt = (p: { status: string }) => p.status;

describe('filterPeriods', () => {
  it('is newest first by start date', () => { expect(filterPeriods(rows, { q: '', status: 'all' }, txt).map((p) => p.id)).toEqual(['c', 'b', 'a']); });
  it('searches label, dates and status words', () => {
    expect(filterPeriods(rows, { q: 'oct 16', status: 'all' }, txt).map((p) => p.id)).toEqual(['b']);
    expect(filterPeriods(rows, { q: '2026-11', status: 'all' }, txt).map((p) => p.id)).toEqual(['c']);
    expect(filterPeriods(rows, { q: 'paid', status: 'all' }, txt).map((p) => p.id)).toEqual(['a']);
  });
  it('filters by status and by an overlapping range', () => {
    expect(filterPeriods(rows, { q: '', status: 'draft' }, txt).map((p) => p.id)).toEqual(['c']);
    expect(filterPeriods(rows, { q: '', status: 'all', from: '2026-10-15', to: '2026-10-16' }, txt).map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('a technician search also shows the periods the server matched (name / phone in the period lines)', () => {
    expect(filterPeriods(rows, { q: 'tran ngoc', status: 'all' }, txt, new Set(['a', 'c'])).map((p) => p.id)).toEqual(['c', 'a']);
    expect(filterPeriods(rows, { q: 'tran ngoc', status: 'paid' }, txt, new Set(['a', 'c'])).map((p) => p.id)).toEqual(['a']);   // status still applies
    expect(filterPeriods(rows, { q: 'tran ngoc', status: 'all' }, txt, null).map((p) => p.id)).toEqual([]);
  });
});
