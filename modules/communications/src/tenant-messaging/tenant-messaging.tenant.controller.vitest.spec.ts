// tenant-messaging.tenant.controller.vitest.spec.ts — the self-service surface must (a) always scope to the session
// tenant, never the client, and (b) require settings.edit to write.
import { describe, it, expect, vi } from 'vitest';
import { TenantMessagingSelfController } from './tenant-messaging.tenant.controller';

const svc = { getMasked: vi.fn(async (t: string) => ({ tenantId: t, provider: 'twilio', status: 'not_configured', accountSid: null, fromNumber: null, authTokenLast4: null })), set: vi.fn(async (u: string, t: string) => ({ tenantId: t, provider: 'twilio', status: 'configured', accountSid: 'AC1', fromNumber: '+18565551234', authTokenLast4: 'oken' })) };
const ctrl = new TenantMessagingSelfController(svc as any);
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
    expect(svc.set).toHaveBeenCalledWith('u1', 'ten_self', expect.objectContaining({ accountSid: 'AC1' }), null);
    expect((out as any).authToken).toBeUndefined();
  });
});
