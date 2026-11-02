// tenant-messaging.tenant.controller.vitest.spec.ts — the self-service surface must (a) always scope to the session
// tenant, never the client, and (b) require settings.edit to write. Phone & Messaging guide (Oct 30 2026): the Test SMS
// needs an explicit confirmation + idempotency key; readiness and the health check are scoped to the session tenant;
// a coded refusal answers with its registry status.
import { describe, it, expect, vi } from 'vitest';
import { TenantMessagingSelfController } from './tenant-messaging.tenant.controller';
import { CredentialsInputError } from './tenant-messaging-credentials.service';
import { withCode } from '@aipowersalon/api-contracts';

const svc = {
  getMasked: vi.fn(async (t: string) => ({ tenantId: t, provider: 'twilio', status: 'not_configured', accountSid: null, fromNumber: null, authTokenLast4: null })),
  set: vi.fn(async (u: string, t: string) => ({ tenantId: t, provider: 'twilio', status: 'configured', accountSid: 'AC1', fromNumber: '+18565551234', authTokenLast4: 'oken' })),
  testSend: vi.fn(async () => ({ ok: true, status: 'accepted' })),
  revealAccountSid: vi.fn(async () => ({ accountSid: 'AC1', branchId: null })),
};
const sync = { refresh: vi.fn(async () => ({ run: { id: 'r1', outcome: 'ok' }, replayed: false })) };
const numbers = { quote: vi.fn(async () => ({ ok: true })), confirmPurchase: vi.fn(async () => ({ ok: true })) };
const readiness = { readiness: vi.fn(async (t: string) => ({ tenant: t })), healthCheck: vi.fn(async (a: any) => ({ tenant: a.tenantId })) };
const ctrl = new TenantMessagingSelfController(svc as any, numbers as any, readiness as any, sync as any);
const req = (perms: string[]) => ({ ctx: { tenantId: 'ten_self', userId: 'u1', permissions: perms } });

describe('TenantMessagingSelfController', () => {
  it('reads scoped to the session tenant', async () => {
    await ctrl.get(req([]));
    expect(svc.getMasked).toHaveBeenCalledWith('ten_self', null);
  });
  it('rejects a write without settings.edit', async () => {
    await expect(ctrl.set(req([]), { accountSid: 'AC1', authToken: 't', fromNumber: '+18565551234' })).rejects.toThrow(/settings.edit/);
  });
  it('allows a write with settings.edit, scoped to the session tenant', async () => {
    const out = await ctrl.set(req(['settings.edit']), { accountSid: 'AC1', authToken: 't', fromNumber: '+18565551234' });
    expect(svc.set).toHaveBeenCalledWith('u1', 'ten_self', expect.objectContaining({ accountSid: 'AC1', confirmUnverified: false }), null);
    expect((out as any).authToken).toBeUndefined();
  });
  it('a coded refusal answers with its registry status (API key without its secret → 422)', async () => {
    const refusing = new TenantMessagingSelfController({ ...svc, set: async () => { throw withCode(new CredentialsInputError('Enter the API key secret'), 'TWILIO_API_KEY_SECRET_REQUIRED'); } } as any, numbers as any, readiness as any);
    await expect(refusing.set(req(['settings.edit']), { accountSid: 'AC1', apiKeySid: 'SK1' })).rejects.toMatchObject({ status: 422, response: { code: 'TWILIO_API_KEY_SECRET_REQUIRED' } });
  });
  it('readiness and the health check use the session tenant only', async () => {
    await ctrl.readiness(req(['settings.view']));
    expect(readiness.readiness).toHaveBeenCalledWith('ten_self', null, null);
    await expect(ctrl.healthCheck(req(['settings.view']), {})).rejects.toThrow(/settings.edit/);
    await ctrl.healthCheck(req(['settings.edit']), {});
    expect(readiness.healthCheck).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_self' }), null, null);
  });
  it('a Test SMS needs an explicit confirmation and an idempotency key', async () => {
    await expect(ctrl.test(req(['settings.edit']), { to: '+15551230000' })).rejects.toMatchObject({ status: 422, response: { code: 'TEST_SMS_CONFIRMATION_REQUIRED' } });
    await expect(ctrl.test(req(['settings.edit']), { to: '+15551230000', confirm: true })).rejects.toMatchObject({ response: { code: 'TEST_SMS_IDEMPOTENCY_KEY_REQUIRED' } });
    await ctrl.test(req(['settings.edit']), { to: '+15551230000', confirm: true, idempotencyKey: 'key-1234-5678' });
    expect(svc.testSend).toHaveBeenCalledWith('u1', 'ten_self', '+15551230000', { idempotencyKey: 'key-1234-5678', requireReady: true, branchId: null, message: null });
  });
  it('PM-01: a branch test SMS goes only to a branch the actor may act for (else 403), with that branch id', async () => {
    const confined = { ctx: { tenantId: 'ten_self', userId: 'u1', permissions: ['settings.edit'], branchId: 'br-1', authz: { scope: 'SELECTED_BRANCHES', branchIds: ['br-1', 'br-2'] } } };
    await expect(ctrl.testBranch(confined, 'br-9', { to: '+15551230000', confirm: true, idempotencyKey: 'key-1234-5679' })).rejects.toMatchObject({ status: 403, response: { code: 'BRANCH_ACCESS_DENIED' } });
    await ctrl.testBranch(confined, 'br-2', { to: '+15551230000', confirm: true, idempotencyKey: 'key-1234-5680' });
    expect(svc.testSend).toHaveBeenCalledWith('u1', 'ten_self', '+15551230000', { idempotencyKey: 'key-1234-5680', requireReady: true, branchId: 'br-2', message: null });
    // a salon-wide actor (no confinement) may name any branch — the service still refuses another salon's (BRANCH_NOT_FOUND, pgtest)
    await ctrl.testBranch(req(['settings.edit']), 'br-9', { to: '+15551230000', confirm: true, idempotencyKey: 'key-1234-5681' });
    expect(svc.testSend).toHaveBeenCalledWith('u1', 'ten_self', '+15551230000', { idempotencyKey: 'key-1234-5681', requireReady: true, branchId: 'br-9', message: null });
    // the branch readiness view follows the same rule, and lists only the actor's branches
    await expect(ctrl.readinessBranch(confined, 'br-9')).rejects.toMatchObject({ status: 403 });
    await ctrl.readinessBranch(confined, 'br-1');
    expect(readiness.readiness).toHaveBeenCalledWith('ten_self', 'br-1', ['br-1', 'br-2']);
  });
  it('PM-02: the full Account SID only through the reveal route (settings.edit), and Refresh Status needs settings.edit', async () => {
    await expect(ctrl.revealSid(req(['settings.view']), {})).rejects.toThrow(/settings.edit/);
    await ctrl.revealSid(req(['settings.edit']), {});
    expect(svc.revealAccountSid).toHaveBeenCalledWith('u1', 'ten_self', null);
    await expect(ctrl.refreshRegistration(req(['settings.view']), { idempotencyKey: 'k-0000-0001' })).rejects.toThrow(/settings.edit/);
    await ctrl.refreshRegistration(req(['settings.edit']), { idempotencyKey: 'k-0000-0002' });
    expect(sync.refresh).toHaveBeenCalledWith('ten_self', { trigger: 'manual', idempotencyKey: 'ui:k-0000-0002', actorUserId: 'u1' });
  });
  it('a purchase goes through the confirmation, scoped to the session tenant', async () => {
    await ctrl.buyNumber(req(['settings.edit']), { phoneNumber: '+18565550001', confirmationToken: 'tok' });
    expect(numbers.confirmPurchase).toHaveBeenCalledWith('u1', 'ten_self', '+18565550001', 'tok');
  });
});
