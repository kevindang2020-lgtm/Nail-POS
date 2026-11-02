// community-evidence.vitest.spec.ts — proves the evidence safety rules: raw bytes never cross tenants, a
// moderator needs a case, unscanned/infected files are never released, and community readers get only a summary.
import { describe, it, expect } from 'vitest';
import { canAccessRawEvidence, evidenceSummary, NotConnectedEvidenceScanner } from './community-evidence';

describe('evidence access-control core (pure)', () => {
  const clean = (owner = 'T1'): any => ({ id: 'e1', ownerTenantId: owner, scanStatus: 'clean', redactionStatus: 'redacted' });
  it('owning tenant manager can access clean evidence; another tenant cannot', () => {
    expect(canAccessRawEvidence({ tenantId: 'T1', role: 'branch_manager', canUploadEvidence: true }, clean()).allowed).toBe(true);
    expect(canAccessRawEvidence({ tenantId: 'T2', role: 'owner', canUploadEvidence: true }, clean()).allowed).toBe(false);
  });
  it('a moderator needs an explicit case', () => {
    expect(canAccessRawEvidence({ tenantId: 'T2', role: 'moderator', canUploadEvidence: false, moderationCaseId: null }, clean()).allowed).toBe(false);
    expect(canAccessRawEvidence({ tenantId: 'T2', role: 'moderator', canUploadEvidence: false, moderationCaseId: 'CASE-1' }, clean()).allowed).toBe(true);
  });
  it('INFECTED evidence is never released — not even to the tenant that uploaded it', () => {
    expect(canAccessRawEvidence({ tenantId: 'T1', role: 'owner', canUploadEvidence: true }, { id: 'e', ownerTenantId: 'T1', scanStatus: 'infected', redactionStatus: 'pending' }).allowed).toBe(false);
    expect(canAccessRawEvidence({ tenantId: 'T2', role: 'moderator', canUploadEvidence: false, moderationCaseId: 'C1' }, { id: 'e', ownerTenantId: 'T1', scanStatus: 'infected', redactionStatus: 'pending' }).allowed).toBe(false);
  });

  it('the OWNING tenant may open its own UNSCANNED file — it already has the bytes', () => {
    // Refusing a salon its own attachment protects nobody (they uploaded it from their own device), and with no
    // scanner wired it would make evidence upload a feature that can never be used.
    const d = canAccessRawEvidence({ tenantId: 'T1', role: 'owner', canUploadEvidence: true }, { id: 'e', ownerTenantId: 'T1', scanStatus: 'unscanned', redactionStatus: 'pending' });
    expect(d.allowed).toBe(true);
  });

  it('SECURITY: a MODERATOR still cannot receive an unscanned file — the scan gates release to a THIRD PARTY', () => {
    const d = canAccessRawEvidence(
      { tenantId: 'T2', role: 'moderator', canUploadEvidence: false, moderationCaseId: 'CASE-1' },
      { id: 'e', ownerTenantId: 'T1', scanStatus: 'unscanned', redactionStatus: 'pending' },
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('not_scanned_clean');
  });

  it('a moderator under a case CAN receive a clean file', () => {
    expect(canAccessRawEvidence(
      { tenantId: 'T2', role: 'moderator', canUploadEvidence: false, moderationCaseId: 'CASE-1' },
      { id: 'e', ownerTenantId: 'T1', scanStatus: 'clean', redactionStatus: 'redacted' },
    ).allowed).toBe(true);
  });
  it('receptionist/technician of the owning tenant cannot access raw evidence', () => {
    expect(canAccessRawEvidence({ tenantId: 'T1', role: 'receptionist', canUploadEvidence: false }, clean()).allowed).toBe(false);
    expect(canAccessRawEvidence({ tenantId: 'T1', role: 'technician', canUploadEvidence: false }, clean()).allowed).toBe(false);
  });
  it('summary exposes counts only', () => {
    const s = evidenceSummary([{ id: '1', ownerTenantId: 'T1', scanStatus: 'clean', redactionStatus: 'redacted' }, { id: '2', ownerTenantId: 'T1', scanStatus: 'unscanned', redactionStatus: 'pending' }]);
    expect(s).toEqual({ count: 2, scanned: 1, redactionPending: 1 });
  });
});

// The evidence SERVICE (presigned upload, size check, scanner fail-closed, own-salon listing, logged access, moderator access
// under an open case) moved to community-interactions.service.ts in BUILD_PLAN Phase 8 and is proven against the real
// schema in community-interactions.pgtest.vitest.spec.ts.

describe('NotConnected scanner never fabricates clean', () => {
  it('returns unscanned', async () => {
    expect((await new NotConnectedEvidenceScanner().scan('k')).status).toBe('unscanned');
  });
});
