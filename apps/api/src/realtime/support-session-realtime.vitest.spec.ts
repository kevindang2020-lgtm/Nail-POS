// support-session-realtime.vitest.spec — Constitution 9 §225, the two named tests and their edges.
import { describe, it, expect } from 'vitest';
import { assertSupportScope, supportSessionVersionPart, isLive, SupportSessionScopeError, KyselySupportSessionSource, type SupportSessionFacts } from './support-session-realtime';
import { authzVersion, untilAuthzChanged, type AuthzFacts } from './authz-revalidation';
import { Subject } from 'rxjs';

const NOW = new Date('2026-09-20T12:00:00Z');
const live = (over: Partial<SupportSessionFacts> = {}): SupportSessionFacts => ({ sessionId: 's1', tenantId: 'A', expiresAt: '2026-09-20T14:00:00Z', endedAt: null, ...over });

/**
 * Asserts the call throws AND carries the expected code. A bare try/catch passes vacuously when nothing
 * throws — the catch block simply never runs — which is how a deleted guard survived the first mutation pass.
 */
function refuses(fn: () => unknown, code: string) {
  expect(fn).toThrow(SupportSessionScopeError);
  try { fn(); throw new Error('unreachable'); }
  catch (e) { expect((e as { code: string }).code).toBe(code); }
}

describe('§225 "Support session Tenant A cannot subscribe Tenant B"', () => {
  it('a live session for A subscribes to A', () => {
    expect(assertSupportScope(live(), 'A', NOW).tenantId).toBe('A');
  });
  it('THE RULE: a live session for A is REFUSED for B', () => {
    refuses(() => assertSupportScope(live(), 'B', NOW), 'support_session_wrong_tenant');
    try { assertSupportScope(live(), 'B', NOW); } catch (e: any) { expect(e.status).toBe(403); }
  });
  it('no session at all is refused, not silently allowed', () => {
    refuses(() => assertSupportScope(null, 'A', NOW), 'support_session_required');
  });
  it('it THROWS rather than returning false — a refusal must not look like an empty stream', () => {
    expect(() => assertSupportScope(null, 'A', NOW)).toThrow();
  });
});

describe('§225 "Expired support session loses streams"', () => {
  it('an expired session cannot subscribe', () => {
    const expired = live({ expiresAt: '2026-09-20T11:00:00Z' });
    expect(isLive(expired, NOW)).toBe(false);
    refuses(() => assertSupportScope(expired, 'A', NOW), 'support_session_expired');
  });
  it('an ENDED session cannot subscribe, even inside its window', () => {
    const ended = live({ endedAt: '2026-09-20T11:30:00Z' });
    refuses(() => assertSupportScope(ended, 'A', NOW), 'support_session_ended');
  });
  it('expiry CHANGES the authorization version, which is what terminates an OPEN stream', () => {
    const s = live();
    const atOpen = supportSessionVersionPart(s, NOW);
    const afterExpiry = supportSessionVersionPart(s, new Date('2026-09-20T14:00:01Z'));
    expect(afterExpiry).not.toBe(atOpen);
    expect(afterExpiry).toMatch(/^dead:/);
  });
  it('ending a session early also changes the version', () => {
    expect(supportSessionVersionPart(live({ endedAt: '2026-09-20T12:30:00Z' }), NOW)).not.toBe(supportSessionVersionPart(live(), NOW));
  });
  it('EXTENDING a session is an authorization change too — the client reconnects into the new window', () => {
    expect(supportSessionVersionPart(live({ expiresAt: '2026-09-20T16:00:00Z' }), NOW)).not.toBe(supportSessionVersionPart(live(), NOW));
  });
  it('a live session hashes STABLY, or every poll would kick the stream', () => {
    expect(supportSessionVersionPart(live(), NOW)).toBe(supportSessionVersionPart(live(), new Date('2026-09-20T13:59:00Z')));
  });
  it('no session hashes stably as "none" — ordinary users are unaffected', () => {
    expect(supportSessionVersionPart(null, NOW)).toBe('none');
  });
  it('two different sessions do not collide', () => {
    expect(supportSessionVersionPart(live({ sessionId: 's2' }), NOW)).not.toBe(supportSessionVersionPart(live(), NOW));
    expect(supportSessionVersionPart(live({ tenantId: 'B' }), NOW)).not.toBe(supportSessionVersionPart(live(), NOW));
  });
});

describe('it composes with the EXISTING revalidation, rather than adding a second timer', () => {
  // The field is DECLARED on AuthzFacts and hashed. A first draft passed it as an extra property via
  // `as never`; authzVersion hashes only declared fields, so it was silently ignored and the version never
  // changed. The test caught it — which is the whole reason not to reach for `as never` to quiet the compiler.
  const facts = (support: string): AuthzFacts => ({ role: 'SUPER_ADMIN', branchId: null, userStatus: 'active', tenantStatus: 'active', branchStatus: null, branchAccess: [], supportSession: support });

  it('the support part changing changes the connection version', () => {
    expect(authzVersion(facts(supportSessionVersionPart(live(), NOW)))).not.toBe(
      authzVersion(facts(supportSessionVersionPart(live(), new Date('2026-09-20T15:00:00Z')))));
  });
  it('an ordinary user with no session is UNAFFECTED by the field existing', () => {
    const plain: AuthzFacts = { role: 'MANAGER', branchId: 'b1', userStatus: 'active', tenantStatus: 'active', branchStatus: 'active', branchAccess: ['b1'] };
    expect(authzVersion(plain)).toBe(authzVersion({ ...plain, supportSession: 'none' }));
  });

  it('an OPEN stream terminates when the session expires mid-flight', async () => {
    let now = NOW;
    const source = { facts: async (): Promise<AuthzFacts> => facts(supportSessionVersionPart(live(), now)) };
    const base = authzVersion(facts(supportSessionVersionPart(live(), NOW)));
    const data$ = new Subject<string>();
    let reason: string | undefined;
    const out = data$.pipe(untilAuthzChanged('u1', 'A', source, () => base, (r) => { reason = r; }, 5));
    const done = new Promise<void>((res) => out.subscribe({ next: () => undefined, complete: () => res() }));
    setTimeout(() => { now = new Date('2026-09-20T15:00:00Z'); }, 10);   // the session expires while connected
    await done;
    expect(reason).toBe('authz_changed');
  });

  it('…and does NOT terminate while the session is still live', async () => {
    const source = { facts: async (): Promise<AuthzFacts> => facts(supportSessionVersionPart(live(), NOW)) };
    const base = authzVersion(facts(supportSessionVersionPart(live(), NOW)));
    const data$ = new Subject<string>();
    let completed = false;
    data$.pipe(untilAuthzChanged('u1', 'A', source, () => base, undefined, 5)).subscribe({ next: () => undefined, complete: () => { completed = true; } });
    await new Promise((r) => setTimeout(r, 40));
    expect(completed).toBe(false);
  });
});

describe('the source reads the existing table and fails CLOSED', () => {
  it('no database → no session, so a tenant stream is refused rather than opened', async () => {
    expect(await new KyselySupportSessionSource(null).activeSessionFor('u1', NOW)).toBeNull();
  });
  it('a query error → null, NOT a session (unlike the authz poll, which fails open)', async () => {
    const broken = { selectFrom: () => { throw new Error('db down'); } };
    expect(await new KyselySupportSessionSource(broken).activeSessionFor('u1', NOW)).toBeNull();
  });
});
