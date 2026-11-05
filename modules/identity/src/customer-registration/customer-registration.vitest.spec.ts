// customer-registration.vitest.spec.ts — the Customer App signup is a §7 creation site too (Jul 26, 2026).
// Proves: a successful registration links the GLOBAL identity with the details the customer typed; the internal
// ids never leak into the API response; a failed registration links nothing; and an identity failure cannot break
// signup.
import { describe, it, expect } from 'vitest';
import { CustomerRegistrationService } from './customer-registration.service';

const okRepo = { register: async () => ({ ok: true, tenantId: 'T1', customerId: 'C1' }) };
const failRepo = { register: async () => ({ ok: false, message: 'We couldn’t find a salon with that code.' }) };
const body = { salonCode: 'ABC', firstName: 'Kevin', lastName: 'Guest', email: 'Kevin@Example.com', phone: '(856) 555-1234', password: 'longenough1' };

describe('customer app registration → global identity', () => {
  it('links the new customer to the global identity and does NOT leak internal ids to the client', async () => {
    const calls: any[] = [];
    const svc = new CustomerRegistrationService(okRepo as any, { ensureLinked: async (c: any, source: any) => { calls.push({ c, source }); return { outcome: 'linked' }; } });
    const res = await svc.register(body as any);
    expect(res).toEqual({ ok: true, message: undefined });        // no tenantId/customerId in the response
    expect(calls.length).toBe(1);
    expect(calls[0].source).toBe('realtime');
    expect(calls[0].c).toMatchObject({ tenantId: 'T1', customerId: 'C1', phoneRaw: '(856) 555-1234', email: 'kevin@example.com' });
  });

  it('a failed registration links nothing', async () => {
    const calls: any[] = [];
    const svc = new CustomerRegistrationService(failRepo as any, { ensureLinked: async (c: any) => { calls.push(c); return {}; } });
    const res = await svc.register(body as any);
    expect(res.ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('an identity-service failure never fails the signup', async () => {
    const svc = new CustomerRegistrationService(okRepo as any, { ensureLinked: async () => { throw new Error('identity down'); } });
    const res = await svc.register(body as any);
    expect(res.ok).toBe(true);
  });

  it('validation still runs before anything is created', async () => {
    const svc = new CustomerRegistrationService(okRepo as any, { ensureLinked: async () => ({}) });
    expect((await svc.register({ ...body, email: 'nope' } as any)).ok).toBe(false);
    expect((await svc.register({ ...body, password: 'short' } as any)).ok).toBe(false);
  });
});
