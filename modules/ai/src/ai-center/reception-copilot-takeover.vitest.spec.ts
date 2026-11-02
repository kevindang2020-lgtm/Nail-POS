import { describe, it, expect, vi } from 'vitest';
import { ReceptionCopilotTakeoverService } from './reception-copilot-takeover.service';
import { ReceptionCopilotLiveStateService } from './reception-copilot-live-state.service';
import { NoopCallTransfer, TelephonyCallTransfer } from './reception-copilot-call-transfer';
import { ProviderNotConnectedError, resolveTelephonyProvider, type TelephonyProvisioningPort } from '../voice-booking/provider-ports';
import { TwilioApiError } from '../voice-booking/twilio-telephony.provider';

const ctx = (perms: string[] = ['reception_copilot.take_over_calls']) => ({ tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'RECEPTION', permissions: perms }) as any;
const audit = () => ({ record: vi.fn(async () => ({})) }) as any;
const liveWith = (active: any) => ({ getActiveCall: async () => active, clearActiveCall: vi.fn(async () => {}) }) as any;

describe('ReceptionCopilotTakeoverService (§24)', () => {
  it('requires take_over_calls permission', async () => {
    const svc = new ReceptionCopilotTakeoverService(new NoopCallTransfer(), liveWith(null), audit());
    expect((await svc.takeOverCall(ctx([]), { providerCallId: 'c1', destination: '+18565551234' })).errorCode).toBe('INSUFFICIENT_PERMISSION');
  });
  it('rejects when the call is not active for this tenant', async () => {
    const svc = new ReceptionCopilotTakeoverService(new NoopCallTransfer(), liveWith(null), audit());
    expect((await svc.takeOverCall(ctx(), { providerCallId: 'c1', destination: '+18565551234' })).errorCode).toBe('CALL_NOT_ACTIVE');
  });
  it('returns NOT_CONFIGURED (never a fake success) when no telephony provider', async () => {
    const svc = new ReceptionCopilotTakeoverService(new NoopCallTransfer(), liveWith({ tenantId: 'ten_A', providerCallId: 'c1' }), audit());
    expect((await svc.takeOverCall(ctx(), { providerCallId: 'c1', destination: '+18565551234' })).errorCode).toBe('CALL_TRANSFER_NOT_CONFIGURED');
  });
  it('transfers, audits, and clears state on success', async () => {
    const transfer = { configured: () => true, transfer: vi.fn(async () => ({ ok: true })) };
    const live = liveWith({ tenantId: 'ten_A', providerCallId: 'c1' });
    const a = audit();
    const svc = new ReceptionCopilotTakeoverService(transfer as any, live, a);
    const r = await svc.takeOverCall(ctx(), { providerCallId: 'c1', destination: '+18565551234', destinationType: 'front_desk' });
    expect(r.ok).toBe(true); expect(r.status).toBe('transferred');
    expect(transfer.transfer).toHaveBeenCalledWith({ providerCallId: 'c1', destination: '+18565551234' });
    expect(a.record).toHaveBeenCalled(); expect(live.clearActiveCall).toHaveBeenCalled();
  });
  it('audits failure and returns CALL_TAKEOVER_FAILED when the provider errors', async () => {
    const transfer = { configured: () => true, transfer: vi.fn(async () => ({ ok: false, error: 'boom' })) };
    const a = audit();
    const svc = new ReceptionCopilotTakeoverService(transfer as any, liveWith({ tenantId: 'ten_A', providerCallId: 'c1' }), a);
    const r = await svc.takeOverCall(ctx(), { providerCallId: 'c1', destination: '+1' });
    expect(r.errorCode).toBe('CALL_TAKEOVER_FAILED');
    expect(a.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'call.takeover_failed' }));
  });
});

describe('ReceptionCopilotLiveStateService (§38) tenant isolation', () => {
  it('active-call state is tenant-scoped — another tenant cannot read it', async () => {
    const svc = new ReceptionCopilotLiveStateService(null as any);   // in-memory fallback
    await svc.setActiveCall({ tenantId: 'ten_A', branchId: 'br_1', userId: 'u1' } as any, { providerCallId: 'c1' });
    expect(await svc.getActiveCall('ten_A', 'c1')).toMatchObject({ tenantId: 'ten_A', providerCallId: 'c1' });
    expect(await svc.getActiveCall('ten_B', 'c1')).toBeNull();   // different tenant namespace
  });
});

describe('TelephonyCallTransfer — B-14: the takeover goes through the ONE telephony adapter, never to Twilio itself', () => {
  const port = (over: Partial<TelephonyProvisioningPort>): TelephonyProvisioningPort => ({
    status: () => ({ state: 'connected', provider: 'twilio', detail: 'x' }), searchNumbers: async () => [], purchaseNumber: async () => ({ phoneNumber: '', providerNumberId: '' }),
    assignNumber: async () => {}, releaseNumber: async () => {}, transferCall: async () => {}, ...over,
  });
  it('without credentials the resolved port is not connected → honest notConfigured, no request', async () => {
    const t = new TelephonyCallTransfer(resolveTelephonyProvider({} as any));
    expect(t.configured()).toBe(false);
    expect(await t.transfer({ providerCallId: 'c', destination: '+1' })).toMatchObject({ ok: false, notConfigured: true });
  });
  it('hands the redirect to the port and succeeds when the port does', async () => {
    const transferCall = vi.fn(async () => {});
    const t = new TelephonyCallTransfer(port({ transferCall }));
    expect(t.configured()).toBe(true);
    expect(await t.transfer({ providerCallId: 'CA123', destination: '+18565551234' })).toEqual({ ok: true });
    expect(transferCall).toHaveBeenCalledWith({ providerCallId: 'CA123', destination: '+18565551234' });
  });
  it('maps the adapter\'s errors: not connected → notConfigured, a provider error → its status + message, never a throw', async () => {
    const nc = new TelephonyCallTransfer(port({ transferCall: async () => { throw new ProviderNotConnectedError('twilio', 'no creds'); } }));
    expect(await nc.transfer({ providerCallId: 'c', destination: '+1' })).toMatchObject({ ok: false, notConfigured: true });
    const err = new TelephonyCallTransfer(port({ transferCall: async () => { throw new TwilioApiError(404, 20404, 'not found'); } }));
    expect(await err.transfer({ providerCallId: 'c', destination: '+1' })).toEqual({ ok: false, error: 'Provider returned 404: not found' });
    const net = new TelephonyCallTransfer(port({ transferCall: async () => { throw new Error('ECONNRESET'); } }));
    expect(await net.transfer({ providerCallId: 'c', destination: '+1' })).toEqual({ ok: false, error: 'ECONNRESET' });
  });
});
