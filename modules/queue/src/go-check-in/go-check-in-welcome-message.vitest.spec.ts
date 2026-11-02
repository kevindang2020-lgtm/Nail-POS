import { describe, it, expect } from 'vitest';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { GoCheckInService } from './go-check-in.service';

// A device's optional welcomeMessage is surfaced read-only in the public KioskConfig so the paired display can render
// it while idle; absent when unset (the display then shows the default welcome).
const mk = async (welcomeMessage?: string) => {
  const repo = new InMemoryGoCheckInRepository();
  const svc = new GoCheckInService(repo as any, {} as any);
  await repo.upsertSettings('t1', { enabled: true });
  await repo.createDevice({ tenantId: 't1', branchId: 'b1', deviceName: 'Front Desk', checkinSlug: 'slug1', ...(welcomeMessage ? { welcomeMessage } : {}) });
  return svc;
};

describe('Go Check-In welcomeMessage in KioskConfig', () => {
  it('getConfig surfaces the device welcome message when set', async () => {
    const svc = await mk('Welcome to Polished Nails!');
    expect((await svc.getConfig('slug1')).welcomeMessage).toBe('Welcome to Polished Nails!');
  });
  it('startSession carries the welcome message too', async () => {
    const svc = await mk('See you soon ✨');
    expect((await svc.startSession('slug1')).config.welcomeMessage).toBe('See you soon ✨');
  });
  it('omits welcomeMessage when the device has none', async () => {
    const svc = await mk();
    expect((await svc.getConfig('slug1')).welcomeMessage).toBeUndefined();
  });
});

describe('Go Check-In confirmationTimeoutSeconds in KioskConfig', () => {
  it('defaults to 12 and is surfaced in KioskConfig.settings', async () => {
    const svc = await mk();
    expect((await svc.getConfig('slug1')).settings.confirmationTimeoutSeconds).toBe(12);
  });
  it('round-trips a custom value set via upsertSettings', async () => {
    const repo = new InMemoryGoCheckInRepository();
    const svc = new GoCheckInService(repo as any, {} as any);
    await repo.upsertSettings('t1', { enabled: true, confirmationTimeoutSeconds: 20 });
    await repo.createDevice({ tenantId: 't1', branchId: 'b1', deviceName: 'D', checkinSlug: 's2' });
    expect((await svc.getConfig('s2')).settings.confirmationTimeoutSeconds).toBe(20);
  });
});
