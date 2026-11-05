// customer-phone-policy.vitest.spec — BUILD_PLAN Phase 3: the tenant's policy is ENFORCED, not just stored.
//
//   E6   a receptionist asserting "shared family phone" skipped the manager review that several matches require;
//        and there was no route for a manager to resolve a conflict at all.
//   —    `require_manager_approval` and `require_reauthentication` were saved by the settings screen and read by
//        nothing.
import { describe, it, expect } from 'vitest';
import { classifyDuplicates, transition } from './customer-phone-core';
import { CustomerPhoneUpdateService, type PhoneStore, type PhoneSettings, type PhoneUpdateCtx } from './customer-phone-update.service';
import { phoneKey } from '@aipowersalon/customers';

const twoOthers = [
  { customerId: 'x1', tenantId: 't1', fullName: 'Ann Lee', isSameCustomer: false, status: 'active_verified' as const },
  { customerId: 'x2', tenantId: 't1', fullName: 'Bo Lee', isSameCustomer: false, status: 'active_unverified' as const },
];

describe('E6 — several customers on one number is a MANAGER’s call, whatever reception asserts', () => {
  it('reception asserting a shared family phone over several matches still needs a manager', () => {
    const r = classifyDuplicates({ matches: twoOthers, customerId: 'c1', customerName: 'Cy Diaz', staffAssertsSharedPhone: true, actorCanResolve: false });
    expect(r).toMatchObject({ outcome: 'multiple_matches', requiresResolution: true, requiresManager: true });
  });
  it('a manager asserting it is recorded as a shared family phone', () => {
    const r = classifyDuplicates({ matches: twoOthers, customerId: 'c1', customerName: 'Cy Diaz', staffAssertsSharedPhone: true, actorCanResolve: true });
    expect(r).toMatchObject({ outcome: 'shared_family_phone', requiresResolution: false });
  });
  it('reception may still record ONE match as a shared family phone (the common case: a parent’s number)', () => {
    const r = classifyDuplicates({ matches: [twoOthers[0]], customerId: 'c1', customerName: 'Cy Diaz', staffAssertsSharedPhone: true, actorCanResolve: false });
    expect(r.outcome).toBe('shared_family_phone');
  });
  it('the state machine has an approval step out of manager review', () => {
    expect(transition('manager_review_required', 'approve')).toEqual({ ok: true, state: 'pending_phone_saved' });
    expect(transition('manager_review_required', 'send_ok').ok).toBe(false);
  });
});

const PHONE = '+15551234567';
const SETTINGS: PhoneSettings = {
  allowReceptionistUpdates: true, requireSmsVerification: true, allowPendingUnverified: true, allowSharedFamilyPhones: true,
  allowManualConfirmation: false, customerAppSelfService: true, notifyOldNumber: true, requireManagerApproval: false, requireReauthentication: true,
};
function build(over: Partial<PhoneSettings> = {}, matches: any[] = []) {
  const calls: string[] = [];
  let state: any = null; let approved = false;
  const store: PhoneStore = {
    async settings() { return { ...SETTINGS, ...over }; },
    async customer() { return { id: 'c1', fullName: 'Cy Diaz', recordVersion: 1 }; },
    async matchesByHash() { return matches; },
    async activePhone() { return { id: 'old-1', mask: '••••0000', status: 'active_verified' as any }; },
    async adoptLegacyPhone() { return null; },
    async openSession() { return null; },
    async sessionByIdempotencyKey() { return null; },
    async createSession(i) { calls.push('createSession:' + i.state); state = i.state; return { id: 's1' }; },
    async session() { return state ? { id: 's1', customerId: 'c1', state, newPhoneHash: phoneKey(PHONE), newPhoneMask: '••••4567', oldPhoneId: 'old-1', source: 'staff_pos' as any, customerVersion: 1, newPhoneId: 'new-1', approved } : null; },
    async setSessionState(_id, st, patch) { calls.push('state:' + st); state = st; if (patch?.approvedBy) approved = true; },
    async closeSession(_t, _id, st) { calls.push('close:' + st); state = st; },
    async savePendingPhone() { calls.push('savePending'); return { id: 'new-1' }; },
    async activate() { calls.push('ACTIVATE'); return true; },
    async proposedPhone() { return PHONE; },
  };
  const svc = new CustomerPhoneUpdateService(store, { async send() { calls.push('send'); return { status: 'code_sent', message: '' }; }, async check() { return { status: 'phone_verified', message: '' }; } }, { async synchronize() { return true; } });
  return { svc, calls };
}
const ctx = (role: any, source: any = 'staff_pos'): PhoneUpdateCtx => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role, source });

describe('require_manager_approval', () => {
  it('a receptionist’s change waits for a manager — no code can be sent before approval', async () => {
    const { svc, calls } = build({ requireManagerApproval: true });
    const r = await svc.start(ctx('RECEPTION'), { customerId: 'c1', newPhone: PHONE });
    expect(r.state).toBe('manager_review_required');
    await expect(svc.sendCode(ctx('RECEPTION'), 's1', PHONE, 'c1')).rejects.toMatchObject({ code: 'invalid_state' });
    expect(calls).not.toContain('send');
  });
  it('reception cannot approve; a manager can, and the change continues to verification', async () => {
    const { svc } = build({ requireManagerApproval: true });
    await svc.start(ctx('RECEPTION'), { customerId: 'c1', newPhone: PHONE });
    await expect(svc.approve(ctx('RECEPTION'), 's1', 'c1')).rejects.toMatchObject({ code: 'forbidden' });
    const a = await svc.approve(ctx('MANAGER'), 's1', 'c1');
    expect(a.state).toBe('pending_phone_saved');
  });
  it('with SMS not required, the manager’s approval activates the number (unverified, honestly)', async () => {
    const { svc, calls } = build({ requireManagerApproval: true, requireSmsVerification: false });
    const r = await svc.start(ctx('RECEPTION'), { customerId: 'c1', newPhone: PHONE });
    expect(r.state).toBe('manager_review_required');
    expect(calls).not.toContain('ACTIVATE');
    const a = await svc.approve(ctx('MANAGER'), 's1', 'c1');
    expect(calls).toContain('ACTIVATE');
    expect(a.activated).toBe(true);
  });
  it('a manager’s own change needs no approval', async () => {
    const { svc } = build({ requireManagerApproval: true });
    expect((await svc.start(ctx('MANAGER'), { customerId: 'c1', newPhone: PHONE })).state).toBe('pending_phone_saved');
  });
});

describe('require_reauthentication (customer app)', () => {
  it('refuses a self-service change without a fresh password check', async () => {
    const { svc } = build();
    await expect(svc.start(ctx('CUSTOMER', 'customer_app'), { customerId: 'c1', newPhone: PHONE })).rejects.toMatchObject({ code: 'reauth_required' });
    await expect(svc.start(ctx('CUSTOMER', 'customer_app'), { customerId: 'c1', newPhone: PHONE, reauth: 'failed' })).rejects.toMatchObject({ code: 'reauth_required' });
  });
  it('allows it after the password check, and when the account has no password to check', async () => {
    expect((await build().svc.start(ctx('CUSTOMER', 'customer_app'), { customerId: 'c1', newPhone: PHONE, reauth: 'ok' })).state).toBe('pending_phone_saved');
    expect((await build().svc.start(ctx('CUSTOMER', 'customer_app'), { customerId: 'c1', newPhone: PHONE, reauth: 'no_password' })).state).toBe('pending_phone_saved');
  });
  it('the setting off: no password asked', async () => {
    expect((await build({ requireReauthentication: false }).svc.start(ctx('CUSTOMER', 'customer_app'), { customerId: 'c1', newPhone: PHONE })).state).toBe('pending_phone_saved');
  });
});

describe('a manager resolves a duplicate conflict', () => {
  const one = [{ customerId: 'x1', tenantId: 't1', fullName: 'Cy Diaz', isSameCustomer: false, status: 'active_verified' }];
  it('reception is blocked by a probable duplicate; a manager’s resolution (with a reason) proceeds and is recorded', async () => {
    const { svc } = build({}, one);
    await expect(svc.start(ctx('RECEPTION'), { customerId: 'c1', newPhone: PHONE })).rejects.toMatchObject({ code: 'duplicate_conflict' });
    await expect(svc.start(ctx('RECEPTION'), { customerId: 'c1', newPhone: PHONE, managerResolution: { resolution: 'different_people', reason: 'Two different clients, checked ID' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.start(ctx('MANAGER'), { customerId: 'c1', newPhone: PHONE, managerResolution: { resolution: 'different_people', reason: 'short' } })).rejects.toMatchObject({ code: 'invalid_state' });
    const r = await svc.start(ctx('MANAGER'), { customerId: 'c1', newPhone: PHONE, managerResolution: { resolution: 'different_people', reason: 'Two different clients, checked ID' } });
    expect(r.state).toBe('pending_phone_saved');
    expect(r.duplicates.outcome).toBe('manager_resolved');
  });
});

describe('rate limits on starting changes', () => {
  it('a customer cycling numbers is stopped at the hourly limit', async () => {
    const { svc } = build();
    (svc as any).store.recentStarts = async () => ({ customer: 6, actor: 6 });
    await expect(svc.start(ctx('MANAGER'), { customerId: 'c1', newPhone: PHONE })).rejects.toMatchObject({ code: 'rate_limited' });
  });
  it('one account working through many customers is stopped too', async () => {
    const { svc } = build();
    (svc as any).store.recentStarts = async () => ({ customer: 0, actor: 40 });
    await expect(svc.start(ctx('MANAGER'), { customerId: 'c1', newPhone: PHONE })).rejects.toMatchObject({ code: 'rate_limited' });
  });
  it('under the limits it proceeds', async () => {
    const { svc } = build();
    (svc as any).store.recentStarts = async () => ({ customer: 5, actor: 39 });
    expect((await svc.start(ctx('MANAGER'), { customerId: 'c1', newPhone: PHONE })).state).toBe('pending_phone_saved');
  });
});
