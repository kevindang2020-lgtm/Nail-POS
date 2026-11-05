// settings-security-autolock.vitest.spec.ts — Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on
// the server, with a full sign-in after 8 hours locked." The salon's value lives in the `security` settings (owner-editable,
// settings.edit) next to "Allow PIN to unlock"; the server reads it as every POS device's maximum idle time.
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.dto';
import { InMemorySettingsRepository } from './settings.repository';
import { PosSettingsService as SettingsService } from './settings.service';

const owner = { tenantId: 't-autolock', branchId: 'b', userId: 'u', role: 'OWNER' as any, permissions: ['settings.view', 'settings.edit'] };

describe('salon auto-lock setting', () => {
  it('defaults: on, 60 minutes', () => {
    expect(DEFAULT_SETTINGS.security).toMatchObject({ autoLockEnabled: true, autoLockMinutes: 60 });
  });
  it('the owner saves another listed choice or switches it off; unlisted minutes and non-booleans are refused', async () => {
    const svc = new SettingsService(new InMemorySettingsRepository());
    expect(await svc.getCategory(owner, 'security')).toMatchObject({ autoLockEnabled: true, autoLockMinutes: 60 });
    expect(await svc.patchCategory(owner, 'security', { autoLockMinutes: 30 })).toMatchObject({ autoLockEnabled: true, autoLockMinutes: 30 });
    expect(await svc.patchCategory(owner, 'security', { autoLockEnabled: false })).toMatchObject({ autoLockEnabled: false, autoLockMinutes: 30 });
    await expect(svc.patchCategory(owner, 'security', { autoLockMinutes: 7 })).rejects.toThrow(/autoLockMinutes/);
    await expect(svc.patchCategory(owner, 'security', { autoLockMinutes: '60' })).rejects.toThrow(/autoLockMinutes/);
    await expect(svc.patchCategory(owner, 'security', { autoLockEnabled: 'yes' })).rejects.toThrow(/autoLockEnabled/);
  });
  it('someone without settings.edit cannot change it', async () => {
    const svc = new SettingsService(new InMemorySettingsRepository());
    await expect(svc.patchCategory({ ...owner, role: 'FRONT_DESK', permissions: ['settings.view'] }, 'security', { autoLockEnabled: false })).rejects.toThrow(/permission/);
  });
});
