// commsInboxCore.test — the SMS Inbox screen's pure rules (Communications guide Oct 30 2026): URL state never carries the search
// text, a filter change resets to page 1, drafts survive per conversation, waiting time and segment counting.
import { describe, it, expect } from 'vitest';
import { readUrlState, writeUrlState, withFilter, listQuery, waitedFor, waitTone, segmentsOf, DraftBook, atBottom, DEFAULT_STATE } from './commsInboxCore';

describe('URL state', () => {
  it('round-trips only non-sensitive filters; defaults are omitted', () => {
    const s = { ...DEFAULT_STATE, sort: 'oldest_unanswered' as const, channel: 'sms', page: 3, size: 50, thread: 'c0330000-0000-4000-8000-000000000001', awaiting: true };
    const qs = writeUrlState(s).toString();
    expect(qs).toBe('sort=oldest_unanswered&channel=sms&awaiting=1&page=3&size=50&thread=c0330000-0000-4000-8000-000000000001');
    expect(readUrlState(new URLSearchParams(qs))).toEqual(s);
    expect(writeUrlState(DEFAULT_STATE).toString()).toBe('');
  });
  it('drops anything invalid: bad sort / size / thread id / reversed custom range; there is no search key at all', () => {
    const r = readUrlState(new URLSearchParams('sort=x&size=37&thread=../etc&preset=custom&from=2026-12-31&to=2026-12-01&q=8565551200'));
    expect(r).toMatchObject({ sort: 'newest', size: 20, thread: null, preset: 'all', from: '', to: '' });
    expect(Object.keys(r)).not.toContain('q');
  });
  it('a filter change resets to page 1 but keeps the open conversation; paging alone keeps the filters', () => {
    const s = { ...DEFAULT_STATE, page: 4, thread: 'c0330000-0000-4000-8000-000000000001' };
    expect(withFilter(s, { channel: 'sms' })).toMatchObject({ page: 1, thread: s.thread, channel: 'sms' });
    expect(withFilter(s, { page: 5 })).toMatchObject({ page: 5 });
  });
  it('the list query adds the search text (server-side) but the URL never does', () => {
    const s = { ...DEFAULT_STATE, preset: 'custom' as const, from: '2026-10-01', to: '2026-10-30' };
    expect(listQuery(s, ' (856) 555-1200 ')).toMatchObject({ q: '(856) 555-1200', preset: 'custom', from: '2026-10-01', to: '2026-10-30', pageSize: '20' });
    expect(writeUrlState(s).toString()).not.toContain('555');
  });
});

describe('waiting, segments, drafts, scroll', () => {
  it('waiting time from real timestamps; urgency bands', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(waitedFor('2026-10-29T09:40:00Z', now)).toMatchObject({ d: 1, h: 2, m: 20 });
    expect(waitedFor(null, now)).toBeNull(); expect(waitedFor('2026-10-30T13:00:00Z', now)?.minutes).toBe(0);
    expect(waitTone(30)).toBe('fresh'); expect(waitTone(90)).toBe('attention'); expect(waitTone(1500)).toBe('urgent');
  });
  it('segments: GSM-7 160 → 1, 161 → 2; one emoji switches to UCS-2', () => {
    expect(segmentsOf('a'.repeat(160))).toMatchObject({ segments: 1, encoding: 'GSM-7' });
    expect(segmentsOf('a'.repeat(161)).segments).toBe(2);
    expect(segmentsOf('Thanks 💅').encoding).toBe('UCS-2');
  });
  it('drafts are kept per conversation until cleared', () => {
    const d = new DraftBook(); d.set('a', 'hello'); d.set('b', 'other');
    expect(d.get('a')).toBe('hello'); expect(d.has('b')).toBe(true); d.set('a', ''); expect(d.has('a')).toBe(false); expect(d.get(null)).toBe('');
  });
  it('auto-scroll only when the reader is at the bottom', () => {
    expect(atBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 80 })).toBe(true);
    expect(atBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 80 })).toBe(false);
  });
});
