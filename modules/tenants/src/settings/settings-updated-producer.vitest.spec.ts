// settings-updated-producer.vitest.spec — BUILD_PLAN Phase 15 (Constitution 9 §246): the realtime settings_updated event is
// produced by the canonical tenant settings save (PosSettingsService.patchCategory → notifySettingsChanged), to the SAVING
// tenant's owner room only, with the category and nothing else — and never for a save that did not happen.
import { describe, it, expect } from 'vitest';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { InMemorySettingsRepository } from './settings.repository';
import { PosSettingsService, ForbiddenError, ValidationError } from './settings.service';
import type { SettingsContext } from './settings.dto';

const owner: SettingsContext = { tenantId: 'tenant-a', branchId: 'br-1', userId: 'u-owner', role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
const front: SettingsContext = { tenantId: 'tenant-a', branchId: 'br-1', userId: 'u-front', role: 'FRONT_DESK', permissions: ['settings.view'] };
const spy = () => {
  const sent: Array<{ room: string; tenantId: string; event: string; payload: unknown }> = [];
  const rt: any = {
    toOwner: (tenantId: string, event: string, payload: unknown) => sent.push({ room: 'owner', tenantId, event, payload }),
    toTenant: (scope: any, event: string, payload: unknown) => sent.push({ room: 'tenant', tenantId: scope?.tenantId, event, payload }),
  };
  return { sent, rt };
};

describe('settings_updated from the tenant settings save', () => {
  it('a saved category sends ONE settings_updated to the saving tenant\'s owner room, payload = the category only', async () => {
    const { sent, rt } = spy();
    const svc = new PosSettingsService(new InMemorySettingsRepository(), undefined, undefined, rt);
    await svc.patchCategory(owner, 'tax', { taxRatePercent: 8.25 });
    expect(sent).toEqual([{ room: 'owner', tenantId: 'tenant-a', event: EVENTS.settingsUpdated, payload: { category: 'tax' } }]);
    expect(EVENTS.settingsUpdated).toBe('settings_updated');
  });
  it('a refused save (no edit permission) and an invalid save send nothing', async () => {
    const { sent, rt } = spy();
    const svc = new PosSettingsService(new InMemorySettingsRepository(), undefined, undefined, rt);
    await expect(svc.patchCategory(front, 'tax', { taxRatePercent: 8 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.patchCategory(owner, 'tax', { taxRatePercent: 250 })).rejects.toBeInstanceOf(ValidationError);
    expect(sent).toEqual([]);
  });
  it('a save whose write fails sends nothing (the event follows the write)', async () => {
    const { sent, rt } = spy();
    const repo = new InMemorySettingsRepository();
    (repo as any).saveCategory = async () => { throw new Error('db down'); };
    const svc = new PosSettingsService(repo, undefined, undefined, rt);
    await expect(svc.patchCategory(owner, 'tax', { taxRatePercent: 8 })).rejects.toThrow('db down');
    expect(sent).toEqual([]);
  });
  it('a broken emitter never fails the save', async () => {
    const svc = new PosSettingsService(new InMemorySettingsRepository(), undefined, undefined, { toOwner: () => { throw new Error('bus down'); } } as any);
    await expect(svc.patchCategory(owner, 'tax', { taxRatePercent: 7 })).resolves.toBeTruthy();
  });
});
