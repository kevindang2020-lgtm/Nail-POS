// service-principals.test.ts — Constitution 3 Step 6: service identities with least-privilege scopes.
import { describe, it, expect } from 'vitest';
import { mintServiceToken, verifyServiceToken, requireServiceCaller, ServiceAuthError, SERVICE_PRINCIPALS } from './service-principals';

const SECRET = 'service-test-secret-service-test-secret-0123';
const NOW = Date.parse('2026-10-04T00:00:00Z');
describe('service tokens', () => {
  it('a principal gets exactly its registry scopes; another scope is refused (least privilege)', () => {
    const t = mintServiceToken('svc.scheduler', { secret: SECRET, now: NOW });
    expect(verifyServiceToken(t, { secret: SECRET, scope: 'jobs.reminders.run', now: NOW + 1000 })).toMatchObject({ ok: true, principal: 'svc.scheduler' });
    expect(verifyServiceToken(t, { secret: SECRET, scope: 'membership_billing.run', now: NOW + 1000 })).toEqual({ ok: false, reason: 'missing_scope' });
    expect(verifyServiceToken(mintServiceToken('svc.backups', { secret: SECRET, now: NOW }), { secret: SECRET, scope: 'backups.report', now: NOW }).ok).toBe(true);
  });
  it('expires in 5 minutes; another secret, a tampered token or a user session token never verify', () => {
    const t = mintServiceToken('svc.billing', { secret: SECRET, now: NOW });
    expect(verifyServiceToken(t, { secret: SECRET, scope: 'membership_billing.run', now: NOW + 301_000 })).toEqual({ ok: false, reason: 'expired' });
    expect(verifyServiceToken(t, { secret: SECRET + 'x', scope: 'membership_billing.run', now: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
    const [pfx, body, sig] = t.split('.'); const forged = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); forged.sub = 'svc.scheduler';
    const fb = Buffer.from(JSON.stringify(forged)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifyServiceToken(`${pfx}.${fb}.${sig}`, { secret: SECRET, scope: 'jobs.reminders.run', now: NOW })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyServiceToken('eyJ1c2VySWQiOiJ1MSJ9.c2ln', { secret: SECRET, scope: 'jobs.reminders.run', now: NOW })).toEqual({ ok: false, reason: 'malformed' });
  });
  it('the REGISTRY decides scopes at verify time — narrowing a principal takes effect on tokens already issued', () => {
    const t = mintServiceToken('svc.scheduler', { secret: SECRET, now: NOW });
    const saved = SERVICE_PRINCIPALS['svc.scheduler'];
    try { (SERVICE_PRINCIPALS as any)['svc.scheduler'] = ['reports.scheduled.run']; expect(verifyServiceToken(t, { secret: SECRET, scope: 'jobs.reminders.run', now: NOW }).ok).toBe(false); }
    finally { (SERVICE_PRINCIPALS as any)['svc.scheduler'] = saved; }
  });
  it('mint refuses an unknown principal and a short secret', () => {
    expect(() => mintServiceToken('svc.root', { secret: SECRET })).toThrow(); expect(() => mintServiceToken('svc.scheduler', { secret: 'short' })).toThrow();
  });
});

describe('requireServiceCaller — the check every internal route makes', () => {
  const env = { SERVICE_TOKEN_SECRET: SECRET, JOBS_SECRET: 'legacy-jobs-secret' } as any;
  const caller = (headers: any, e: any = env) => { try { return requireServiceCaller({ headers }, 'jobs.reminders.run', { name: 'JOBS_SECRET', secret: e.JOBS_SECRET, header: 'x-jobs-secret' }, e); } catch (x) { return x as ServiceAuthError; } };
  it('a service token with the scope → its principal; without the scope → 403; a bad token → 401', () => {
    expect(caller({ authorization: 'Bearer ' + mintServiceToken('svc.scheduler', { secret: SECRET }) })).toEqual({ principal: 'svc.scheduler', via: 'service_token' });
    expect((caller({ authorization: 'Bearer ' + mintServiceToken('svc.billing', { secret: SECRET }) }) as ServiceAuthError).status).toBe(403);
    expect((caller({ authorization: 'Bearer svc.bad.token' }) as ServiceAuthError).status).toBe(401);
  });
  it('the legacy header works only while its variable is set; a wrong legacy value is refused; nothing configured → 503', () => {
    expect(caller({ 'x-jobs-secret': 'legacy-jobs-secret' })).toEqual({ principal: 'legacy:JOBS_SECRET', via: 'legacy_header' });
    expect((caller({ 'x-jobs-secret': 'legacy-jobs-secreT' }) as ServiceAuthError).status).toBe(403);
    expect((caller({ 'x-jobs-secret': 'legacy-jobs-secret' }, { SERVICE_TOKEN_SECRET: SECRET }) as ServiceAuthError).status).toBe(403);   // variable removed → retired
    expect((caller({}, {}) as ServiceAuthError).status).toBe(503);
  });
});
