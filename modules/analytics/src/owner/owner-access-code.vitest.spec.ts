// Owner Access Code provisioning (OwnerService.setOwnerAccessCode / getSecurityStatus).
//
// The security rules that must hold: only an OWNER, only for her own account, changing it requires the CURRENT
// password, the stored value is a HASH (never the plaintext), a blank new code REMOVES it, and the change is audited.
import { describe, it, expect, vi } from 'vitest';
import { OwnerService, OwnerError } from './owner.service';
import { hashPassword } from '@aipowersalon/auth';
import { permissionsFor } from '@aipowersalon/permissions';
import type { OwnerContext } from './owner.repository';

function makeRepo(over: Record<string, unknown> = {}) {
  return {
    ownerPasswordHash: vi.fn(async () => null),
    ownerAccessCodeConfigured: vi.fn(async () => false),
    setOwnerAccessCodeHash: vi.fn(async () => {}),
    writeAudit: vi.fn(async () => {}),
    ...over,
  } as any;
}
// BUILD_PLAN Phase 9: contexts carry their role's real permissions (the code is gated by owner.settings.edit, not the name)
const ownerCtx: OwnerContext = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: permissionsFor('OWNER') };

describe('OwnerService — Owner Access Code provisioning', () => {
  it('refuses a non-owner', async () => {
    const svc = new OwnerService(makeRepo());
    await expect(svc.setOwnerAccessCode({ ...ownerCtx, role: 'MANAGER', permissions: permissionsFor('MANAGER') }, { currentPassword: 'x', newCode: '1234' })).rejects.toBeInstanceOf(OwnerError);
  });

  it('refuses a wrong current password (and never touches the code)', async () => {
    const pw = await hashPassword('correct-horse');
    const repo = makeRepo({ ownerPasswordHash: async () => pw });
    const svc = new OwnerService(repo);
    await expect(svc.setOwnerAccessCode(ownerCtx, { currentPassword: 'wrong', newCode: '1234' })).rejects.toThrow(/current password/i);
    expect(repo.setOwnerAccessCodeHash).not.toHaveBeenCalled();
  });

  it('stores a HASH (not the plaintext) after verifying the password, and audits it', async () => {
    const pw = await hashPassword('correct-horse');
    const repo = makeRepo({ ownerPasswordHash: async () => pw });
    const svc = new OwnerService(repo);
    const r = await svc.setOwnerAccessCode(ownerCtx, { currentPassword: 'correct-horse', newCode: 'GOLD-77' });
    expect(r).toEqual({ ok: true, configured: true });
    const stored = repo.setOwnerAccessCodeHash.mock.calls[0][1];
    expect(stored).toBeTruthy();
    expect(stored).not.toBe('GOLD-77'); // hashed, never the raw code
    expect(repo.writeAudit).toHaveBeenCalledWith(ownerCtx, expect.objectContaining({ action: 'owner_access_code_set' }));
  });

  it('removes the code (null) when the new code is blank', async () => {
    const pw = await hashPassword('correct-horse');
    const repo = makeRepo({ ownerPasswordHash: async () => pw });
    const svc = new OwnerService(repo);
    const r = await svc.setOwnerAccessCode(ownerCtx, { currentPassword: 'correct-horse', newCode: '   ' });
    expect(r).toEqual({ ok: true, configured: false });
    expect(repo.setOwnerAccessCodeHash).toHaveBeenCalledWith(ownerCtx, null);
    expect(repo.writeAudit).toHaveBeenCalledWith(ownerCtx, expect.objectContaining({ action: 'owner_access_code_cleared' }));
  });

  it('rejects a too-short code', async () => {
    const pw = await hashPassword('correct-horse');
    const svc = new OwnerService(makeRepo({ ownerPasswordHash: async () => pw }));
    await expect(svc.setOwnerAccessCode(ownerCtx, { currentPassword: 'correct-horse', newCode: '12' })).rejects.toThrow(/4/);
  });

  it('getSecurityStatus reports whether a code is configured', async () => {
    const svc = new OwnerService(makeRepo({ ownerAccessCodeConfigured: async () => true }));
    expect(await svc.getSecurityStatus(ownerCtx)).toEqual({ accessCodeConfigured: true });
  });
});

describe('Phase 9 — the Owner Access Code is owner.settings.edit, not the OWNER role name', () => {
  it('an OWNER-role session with owner.settings.edit DENIED is refused before any password check', async () => {
    const svc = new OwnerService({} as any);
    await expect(svc.getSecurityStatus({ ...ownerCtx, permissions: permissionsFor('OWNER').filter((k) => k !== 'owner.settings.edit') })).rejects.toBeInstanceOf(OwnerError);
  });
});
