// authz-revalidation.vitest.spec — Constitution 9 §42/§43/§44/§127/§128 (and §226/§227 test requirements):
// an open stream ends when the authorization it was opened with changes underneath it.
import { describe, it, expect, vi } from 'vitest';
import { Subject, firstValueFrom, toArray } from 'rxjs';
import { untilAuthzChanged, authzVersion, isTerminal, type AuthzFacts, type AuthzVersionSource } from './authz-revalidation';

const facts = (o: Partial<AuthzFacts> = {}): AuthzFacts => ({
  role: 'BRANCH_MANAGER', branchId: 'b-1', userStatus: 'active', tenantStatus: 'active', branchStatus: 'active', branchAccess: ['b-1', 'b-2'], ...o,
});
const src = (f: () => AuthzFacts | null): AuthzVersionSource => ({ facts: async () => f() });

describe('§127 authorization version', () => {
  it('is stable for equal facts (any order of branch access) and changes for any authorization-bearing fact', () => {
    const base = authzVersion(facts());
    expect(authzVersion(facts({ branchAccess: ['b-2', 'b-1'] }))).toBe(base);         // order-independent
    expect(authzVersion(facts({ role: 'TECHNICIAN' }))).not.toBe(base);                // §42 demotion
    expect(authzVersion(facts({ branchAccess: ['b-1'] }))).not.toBe(base);             // §42 "loses Branch B access"
    expect(authzVersion(facts({ branchId: 'b-9' }))).not.toBe(base);                   // moved branch
    expect(authzVersion(null)).toBe('absent');                                         // user deleted
  });
  it('§43/§44 terminal facts need no comparison: suspended user, suspended tenant, deactivated home branch', () => {
    expect(isTerminal(facts())).toBe(false);
    expect(isTerminal(facts({ userStatus: 'suspended' }))).toBe(true);
    expect(isTerminal(facts({ tenantStatus: 'suspended' }))).toBe(true);
    expect(isTerminal(facts({ branchStatus: 'inactive' }))).toBe(true);
    expect(isTerminal(null)).toBe(true);
  });
});

describe('§42/§128 the operator on a live stream', () => {
  it('ends the stream on the first poll after the role changes — not at next login', async () => {
    vi.useFakeTimers();
    let current = facts();
    const initial = authzVersion(current);
    const s = new Subject<number>(); const reasons: string[] = [];
    const out = firstValueFrom(s.pipe(untilAuthzChanged('u-1', 't-1', src(() => current), () => initial, (r) => reasons.push(r), 1000), toArray()));
    s.next(1);
    await vi.advanceTimersByTimeAsync(1000);          // poll 1: unchanged → still open
    s.next(2);
    current = facts({ branchAccess: ['b-1'] });        // admin removes Branch B
    await vi.advanceTimersByTimeAsync(1000);          // poll 2: version differs → complete
    s.next(3);                                        // after termination: not delivered
    expect(await out).toEqual([1, 2]);
    expect(reasons).toEqual(['authz_changed']);
    vi.useRealTimers();
  });
  it('§43 a tenant suspended mid-stream ends it even before the initial version resolved (terminal path)', async () => {
    vi.useFakeTimers();
    let current = facts();
    const s = new Subject<number>(); const reasons: string[] = [];
    const out = firstValueFrom(s.pipe(untilAuthzChanged('u-1', 't-1', src(() => current), () => null, (r) => reasons.push(r), 1000), toArray()));
    s.next(1);
    current = facts({ tenantStatus: 'suspended' });
    await vi.advanceTimersByTimeAsync(1000);
    s.next(2);
    expect(await out).toEqual([1]);
    expect(reasons).toEqual(['terminal']);
    vi.useRealTimers();
  });
  it('fail-open: a lookup error never disconnects (a DB blip must not drop every user in the salon)', async () => {
    vi.useFakeTimers();
    const s = new Subject<number>();
    const failing: AuthzVersionSource = { facts: async () => { throw new Error('db down'); } };
    const seen: number[] = [];
    s.pipe(untilAuthzChanged('u-1', 't-1', failing, () => 'v1', undefined, 1000)).subscribe((v) => seen.push(v));
    s.next(1); await vi.advanceTimersByTimeAsync(3000); s.next(2);
    expect(seen).toEqual([1, 2]);
    vi.useRealTimers();
  });
  it('no user/tenant/source → the stream is untouched (unit harness, legacy tokens)', () => {
    const s = new Subject<number>(); const seen: number[] = [];
    s.pipe(untilAuthzChanged(undefined, undefined, undefined, () => null)).subscribe((v) => seen.push(v));
    s.next(1); s.next(2);
    expect(seen).toEqual([1, 2]);
  });
});
