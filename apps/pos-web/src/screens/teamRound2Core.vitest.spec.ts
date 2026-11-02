// teamRound2Core.vitest.spec — the PURE rules of Team Management round 2A, runnable without the pos-web toolchain:
// TM-02 URL state (allowlists, defaults out, the search never in the URL, filter change → page 1, bad page / size),
// TM-03 the creation return path (filters kept, page / sort reset, ?created=), TM-05 the indicator + stale-answer guard.
import { describe, it, expect } from 'vitest';
import { readTeamUrl, teamQuery, nextTeamUrl, clearedTeamUrl, teamCreatedPath, teamAddPath, TEAM_DEFAULTS } from './teamUrlCore';
import { liveModeOf, isStale } from './teamLiveCore';

const ID = '11111111-2222-4333-8444-555555555555';
describe('TM-02 URL state', () => {
  it('reads every value through an allowlist and writes a clean link without the search', () => {
    const s = readTeamUrl(new URLSearchParams('tab=managers&role=manager&status=on_break&shift=scheduled&dept=front_desk&account=all&extra=no_login&sort=name&basis=created&preset=custom&from=2026-10-01&to=2026-10-15&page=3&size=50&mode=customer&q=8565551201'));
    expect(s).toEqual({ tab: 'managers', role: 'manager', status: 'on_break', shift: 'scheduled', department: 'front_desk', account: 'all', extra: 'no_login', sort: 'name', basis: 'created',
      period: { preset: 'custom', from: '2026-10-01', to: '2026-10-15' }, page: 3, size: 50, mode: 'customer', created: null });
    const q = teamQuery(s).toString();
    expect(q).toBe('tab=managers&role=manager&status=on_break&shift=scheduled&dept=front_desk&account=all&extra=no_login&sort=name&basis=created&preset=custom&from=2026-10-01&to=2026-10-15&page=3&size=50&mode=customer');
    expect(q).not.toMatch(/8565551201|q=/);
    expect(readTeamUrl(new URLSearchParams(q))).toEqual(s);                 // refresh / Back restore the same state
    expect(teamQuery(TEAM_DEFAULTS).toString()).toBe('');
  });
  it('drops unknown values; a bad page is 1, a bad size 10; a reversed custom range collapses to its start', () => {
    const s = readTeamUrl(new URLSearchParams('role=ceo&status=x&sort=evil&size=7&page=-4&preset=custom&from=2026-10-10&to=2026-10-01&created=not-an-id'));
    expect(s).toMatchObject({ role: '', status: '', sort: 'newest', size: 10, page: 1, period: { preset: 'custom', from: '2026-10-10', to: '2026-10-10' }, created: null });
    expect(readTeamUrl(new URLSearchParams('page=abc&size=20')).page).toBe(1); expect(readTeamUrl(new URLSearchParams('size=20')).size).toBe(20);
    expect(readTeamUrl(new URLSearchParams('preset=custom')).period).toEqual({ preset: 'month' });
  });
  it('a filter (or size / mode / period) change returns to page 1; a page change keeps the filters', () => {
    const s = readTeamUrl(new URLSearchParams('role=manager&page=4'));
    for (const patch of [{ status: 'off' }, { size: 20 }, { mode: 'customer' as const }, { period: { preset: 'week' as const } }, { tab: 'managers' }]) expect(nextTeamUrl(s, patch).page).toBe(1);
    expect(nextTeamUrl(s, { role: 'manager' }).page).toBe(4);                // the same value is not a change
    expect(nextTeamUrl(s, { page: 2 })).toMatchObject({ page: 2, role: 'manager' });
    expect(clearedTeamUrl({ ...s, size: 50, created: ID })).toMatchObject({ role: '', page: 1, size: 50, created: ID });
  });
});
describe('TM-03 creation return path', () => {
  it('keeps the team list filters, resets page / sort, carries ?created=', () => {
    expect(teamCreatedPath(ID)).toBe(`/tenant/team/members?created=${ID}`);
    expect(teamCreatedPath(ID, 'role=receptionist&page=4&sort=name&size=20')).toBe(`/tenant/team/members?role=receptionist&size=20&created=${ID}`);
    expect(teamAddPath(new URLSearchParams('role=receptionist&page=2'))).toBe('/technicians?new=1&returnTo=team&back=' + encodeURIComponent('role=receptionist'));
    expect(teamAddPath(new URLSearchParams(''))).toBe('/technicians?new=1&returnTo=team');
  });
});
describe('TM-05 live indicator + stale guard', () => {
  it('is Live only while CONNECTED', () => {
    expect(liveModeOf('CONNECTED', false)).toBe('live'); expect(liveModeOf('CONNECTED', true)).toBe('live');
    expect(liveModeOf('RECONNECTING', false)).toBe('reconnecting'); expect(liveModeOf('RECONNECTING', true)).toBe('polling');
    expect(liveModeOf('OFFLINE', false)).toBe('polling'); expect(liveModeOf('DEGRADED', false)).toBe('polling');
  });
  it('an older answer never replaces a newer one', () => {
    expect(isStale({ asOf: '2026-10-30T15:00:00Z' }, { asOf: '2026-10-30T15:00:01Z' })).toBe(true);
    expect(isStale({ asOf: '2026-10-30T15:00:01Z' }, { asOf: '2026-10-30T15:00:00Z' })).toBe(false);
    expect(isStale({ asOf: '2026-10-30T15:00:00Z' }, { asOf: '2026-10-30T15:00:00Z' })).toBe(false);
    expect(isStale({}, { asOf: '2026-10-30T15:00:00Z' })).toBe(false); expect(isStale({ asOf: '2026-10-30T15:00:00Z' }, null)).toBe(false);
  });
});
