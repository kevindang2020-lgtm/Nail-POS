// inbox-core.vitest.spec — the pure rules of the SMS Inbox (Communications guide Oct 30 2026): query parsing, salon-local
// periods (year end, DST, reversed range), search classification, evidence-only delivery states, timeline merge order + cursor.
import { describe, it, expect } from 'vitest';
import { parseInboxQuery, resolveInboxPeriod, parseSearch, deliveryState, answersCustomer, blockReasonCode, mergeTimeline, decodeCursor, encodeCursor, normalizePhone, maskPhone, automatedType, InboxError, callbackHealth } from './inbox-core';
import type { InboxTimelineEvent as TimelineEvent } from '@aipowersalon/api-contracts/tenant';

const ev = (id: string, at: string, source: TimelineEvent['source'] = 'message'): TimelineEvent => ({ id, source, type: 'x', channel: 'sms', direction: 'inbound', actorKind: 'customer', actorName: null, at, state: null, body: null, summary: null, ref: null, threadId: null, errorCode: null });

describe('parseInboxQuery', () => {
  it('defaults: newest, 20 per page, page 1, any date, last-activity basis', () => {
    expect(parseInboxQuery({})).toMatchObject({ sort: 'newest', pageSize: 20, page: 1, preset: 'all', basis: 'last_activity', channel: null, status: null, assignee: null, search: null });
  });
  it('only 10 / 20 / 50 page sizes; unknown values fall back; me / unassigned / uuid assignee only', () => {
    expect(parseInboxQuery({ pageSize: '50' }).pageSize).toBe(50);
    expect(parseInboxQuery({ pageSize: '37' }).pageSize).toBe(20);
    expect(parseInboxQuery({ sort: 'drop table', channel: 'fax', status: 'x' })).toMatchObject({ sort: 'newest', channel: null, status: null });
    expect(parseInboxQuery({ assignee: 'me' }).assignee).toBe('me');
    expect(parseInboxQuery({ assignee: 'bob' }).assignee).toBeNull();
    expect(parseInboxQuery({ from: '2026-10-01', to: '2026-10-02' }).preset).toBe('custom');
  });
});

describe('resolveInboxPeriod (salon time zone)', () => {
  const tz = 'America/New_York';
  it('Today is the salon day, not UTC: 11:30 pm New York on Dec 31 is still Dec 31', () => {
    const p = resolveInboxPeriod({ preset: 'today', from: null, to: null }, tz, new Date('2027-01-01T04:30:00Z'));
    expect(p).toMatchObject({ from: '2026-12-31', to: '2026-12-31', today: '2026-12-31' });
  });
  it('This Week runs Monday → Sunday; This Month spans the whole month', () => {
    expect(resolveInboxPeriod({ preset: 'week', from: null, to: null }, tz, new Date('2026-10-30T15:00:00Z'))).toMatchObject({ from: '2026-10-26', to: '2026-11-01' });
    expect(resolveInboxPeriod({ preset: 'month', from: null, to: null }, tz, new Date('2026-02-10T15:00:00Z'))).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
  });
  it('custom: valid dates only, end not before start, bounded length', () => {
    expect(resolveInboxPeriod({ preset: 'custom', from: '2026-11-01', to: '2026-11-01' }, tz)).toMatchObject({ from: '2026-11-01', to: '2026-11-01' });
    const code = (f: () => unknown) => { try { f(); return 'ok'; } catch (e) { return (e as InboxError).code; } };
    expect(code(() => resolveInboxPeriod({ preset: 'custom', from: '2026-12-31', to: '2026-12-01' }, tz))).toBe('DATE_RANGE_INVALID');
    expect(code(() => resolveInboxPeriod({ preset: 'custom', from: '2026-02-30', to: '2026-03-01' }, tz))).toBe('DATE_INVALID');
    expect(code(() => resolveInboxPeriod({ preset: 'custom', from: '1990-01-01', to: '2026-01-01' }, tz))).toBe('DATE_RANGE_TOO_LARGE');
  });
});

describe('parseSearch', () => {
  it('phones in any format → the last 10 digits; ids; emails; ticket refs; plain text', () => {
    for (const s of ['8565551200', '(856) 555-1200', '+1 856 555 1200', '856.555.1200']) expect(parseSearch(s)?.digits).toBe('8565551200');
    expect(parseSearch('Mai Le')?.digits).toBeNull();
    expect(parseSearch('c0330000-0000-4000-8000-000000000001')?.uuid).toBe('c0330000-0000-4000-8000-000000000001');
    expect(parseSearch('Jane@Lotus.test')?.email).toBe('jane@lotus.test');
    expect(parseSearch('T-1042')?.ref).toBe('1042');
    expect(parseSearch('   ')).toBeNull();
  });
  it('E.164 normalisation and masking', () => {
    expect(normalizePhone('(856) 555-1200')).toBe('+18565551200'); expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958'); expect(normalizePhone('12')).toBeNull();
    expect(maskPhone('+18565551200')).toBe('•••-•••-1200');
  });
});

describe('deliveryState — evidence only', () => {
  const base = { direction: 'outbound', messageStatus: 'sent', notificationId: 'n1', ledgerStatus: 'sent', providerStatus: null, failureReason: null, providerErrorCode: null };
  it('accepted by the provider is Submitted, never Delivered; Delivered only from the ledger / callback', () => {
    expect(deliveryState(base)).toBe('submitted');
    expect(deliveryState({ ...base, providerStatus: 'sent' })).toBe('sent');
    expect(deliveryState({ ...base, ledgerStatus: 'delivered', providerStatus: 'delivered' })).toBe('delivered');
  });
  it('queued then failed never shows Delivered; undelivered is told apart; refused before sending is Blocked', () => {
    expect(deliveryState({ ...base, ledgerStatus: 'failed', providerStatus: 'failed' })).toBe('failed');
    expect(deliveryState({ ...base, ledgerStatus: 'failed', providerStatus: 'undelivered' })).toBe('undelivered');
    expect(deliveryState({ ...base, ledgerStatus: 'blocked', failureReason: 'opted_out' })).toBe('blocked');
    expect(deliveryState({ ...base, notificationId: null, messageStatus: 'pending' })).toBe('sending');
  });
  it('a message recorded before replies were really sent has no ledger row: Not tracked (never "Sent")', () => {
    expect(deliveryState({ ...base, notificationId: null, ledgerStatus: null })).toBe('not_tracked');
    expect(deliveryState({ ...base, direction: 'inbound' })).toBe('received');
  });
  it('only a reply that left for the provider answers the customer; reasons are stable codes', () => {
    expect(answersCustomer('submitted')).toBe(true); expect(answersCustomer('blocked')).toBe(false); expect(answersCustomer('failed')).toBe(false);
    expect(blockReasonCode('opted_out')).toBe('OPTED_OUT'); expect(blockReasonCode('provider_undelivered')).toBe('PROVIDER_UNDELIVERED'); expect(blockReasonCode('Error: twilio 21610 blah')).toBe('SEND_FAILED');
  });
});

describe('mergeTimeline', () => {
  it('oldest → newest, deterministic ties, de-duplicated, newest page kept with a cursor to older', () => {
    const a = [ev('m2', '2026-10-02T10:00:00Z'), ev('m1', '2026-10-01T10:00:00Z')];
    const b = [ev('c1', '2026-10-02T10:00:00Z', 'call'), ev('m1', '2026-10-01T10:00:00Z')];
    const r = mergeTimeline([a, b], 2);
    expect(r.events.map((e) => e.source + ':' + e.id)).toEqual(['call:c1', 'message:m2']);   // same instant: the call (rank) before the text
    expect(r.olderCursor).not.toBeNull(); expect(decodeCursor(r.olderCursor)).toMatchObject({ at: '2026-10-02T10:00:00Z', id: 'c1' });
    expect(mergeTimeline([a], 10).olderCursor).toBeNull();
  });
  it('a bad cursor is ignored, not trusted', () => {
    expect(decodeCursor('not-base64-json')).toBeNull(); expect(decodeCursor(encodeCursor({ at: 'nope', id: 'x', source: 'message' }))).toBeNull();
  });
  it('automated text kinds: one-time codes and receipts never show their body', () => {
    expect(automatedType('account')).toEqual({ type: 'verification_code', showBody: false });
    expect(automatedType('reminder').type).toBe('appointment_reminder'); expect(automatedType(null).type).toBe('automated_message');
  });
});

describe('callbackHealth (missing webhook warning — timestamps only)', () => {
  it('ok when nothing waits; stale when no callback since the oldest waiting text; delayed when callbacks still arrive', () => {
    expect(callbackHealth({ awaiting: 0, oldestAwaitingAt: null, lastCallbackAt: null }).state).toBe('ok');
    expect(callbackHealth({ awaiting: 2, oldestAwaitingAt: '2026-11-10T10:00:00Z', lastCallbackAt: null }).state).toBe('stale');
    expect(callbackHealth({ awaiting: 2, oldestAwaitingAt: '2026-11-10T10:00:00Z', lastCallbackAt: '2026-11-10T09:00:00Z' }).state).toBe('stale');
    expect(callbackHealth({ awaiting: 2, oldestAwaitingAt: '2026-11-10T10:00:00Z', lastCallbackAt: '2026-11-10T11:00:00Z' })).toMatchObject({ state: 'delayed', awaiting: 2, waitMinutes: 30, lookbackDays: 7 });
  });
});
