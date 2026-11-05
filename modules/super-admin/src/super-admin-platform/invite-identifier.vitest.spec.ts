// invite-identifier.vitest.spec.ts — staff can be set up with an email, a phone, or both, and the identifier the
// admin enters is exactly the one that works at the sign-in screen (Jul 27, 2026).
import { describe, it, expect } from 'vitest';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { normalizeIdentifier } from '@aipowersalon/auth';

const ctx = { userId: 'u_admin', role: 'SUPER_ADMIN' } as any;

function harness(existing: { emails?: string[]; phones?: { tenantId: string | null; phone: string }[] } = {}) {
  const invited: any[] = [];
  const repo = {
    emailExists: async (e: string) => (existing.emails || []).includes(e),
    phoneExists: async (tenantId: string | null, p: string) =>
      (existing.phones || []).some((x) => x.phone === p && x.tenantId === tenantId),
    inviteUser: async (input: any) => { invited.push(input); return { id: 'usr_1', temporaryPassword: 'Tmp-1234' }; },
    writeAudit: async () => {},
    insertAudit: async () => {},
  } as any;
  return { svc: new SuperAdminPlatformService(repo), invited };
}

describe('staff setup — email or phone', () => {
  it('a phone-only account is stored E.164-normalized, which is what sign-in matches on', async () => {
    const { svc, invited } = harness();
    const r = await svc.inviteUser(ctx, { phone: '(856) 555-1234', fullName: 'Front Desk', role: 'FRONT_DESK', tenantId: 'T1' });
    expect(invited[0].phone).toBe('+18565551234');
    expect(invited[0].email).toBeNull();
    expect(r.phone).toBe('+18565551234');
    // the same number typed any way at login normalizes to the stored value
    expect(normalizeIdentifier('856-555-1234').value).toBe(invited[0].phone);
    expect(normalizeIdentifier('+1 856 555 1234').value).toBe(invited[0].phone);
  });

  it('an email-only account still works exactly as before', async () => {
    const { svc, invited } = harness();
    await svc.inviteUser(ctx, { email: 'Manager@Salon.com', fullName: 'A Manager', role: 'MANAGER', tenantId: 'T1' });
    expect(invited[0].email).toBe('manager@salon.com');
    expect(invited[0].phone).toBeNull();
  });

  it('both identifiers can be set together — either one signs the person in', async () => {
    const { svc, invited } = harness();
    await svc.inviteUser(ctx, { email: 'mia@salon.com', phone: '8565551234', fullName: 'Mia Tran', role: 'TECHNICIAN', tenantId: 'T1' });
    expect(invited[0]).toMatchObject({ email: 'mia@salon.com', phone: '+18565551234' });
  });

  it('neither identifier is refused with a message that says what to do', async () => {
    const { svc } = harness();
    await expect(svc.inviteUser(ctx, { fullName: 'Nobody', role: 'MANAGER', tenantId: 'T1' }))
      .rejects.toThrow(/email address or a phone number/i);
  });

  it('a malformed phone is refused instead of silently stored as an unusable login', async () => {
    const { svc } = harness();
    await expect(svc.inviteUser(ctx, { phone: '12', fullName: 'Bad Phone', role: 'MANAGER', tenantId: 'T1' }))
      .rejects.toThrow(/phone number is not valid/i);
  });

  it('a phone already used in the SAME salon is blocked; the same number in another salon is fine', async () => {
    const taken = { phones: [{ tenantId: 'T1', phone: '+18565551234' }] };
    const a = harness(taken);
    await expect(a.svc.inviteUser(ctx, { phone: '856 555 1234', fullName: 'Dup Staff', role: 'MANAGER', tenantId: 'T1' }))
      .rejects.toThrow(/already signs in with that phone/i);
    const b = harness(taken);
    await b.svc.inviteUser(ctx, { phone: '856 555 1234', fullName: 'Other Salon', role: 'MANAGER', tenantId: 'T2' });
    expect(b.invited[0].phone).toBe('+18565551234');   // sign-in lookup is tenant-scoped, so this can't collide
  });
});

describe('token invitations — addressed to an email or a phone', () => {
  function inviteHarness() {
    const calls: any[] = [];
    const repo = {
      createInvitation: async (input: any) => { calls.push(input); return { id: 'inv_1', userId: 'usr_1', token: 'raw-token', tokenPrefix: 'raw-', expiresAt: '2026-08-01T00:00:00.000Z', reused: false }; },
      setInvitationDelivery: async () => {},
      writeAudit: async () => {}, insertAudit: async () => {},
    } as any;
    return { svc: new SuperAdminPlatformService(repo), calls };
  }

  it('a phone-only invitation is normalized and defaults to the SMS channel', async () => {
    const { svc, calls } = inviteHarness();
    const r = await svc.createInvitation(ctx, { phone: '(856) 555-1234', role: 'TECHNICIAN', tenantId: 'T1', fullName: 'A Tech' });
    expect(calls[0]).toMatchObject({ email: null, phone: '+18565551234', channel: 'sms' });
    expect(r.phone).toBe('+18565551234');
  });

  it('asking for the email channel with no email address falls back to SMS rather than sending nowhere', async () => {
    const { svc, calls } = inviteHarness();
    await svc.createInvitation(ctx, { phone: '8565551234', role: 'TECHNICIAN', tenantId: 'T1', channel: 'email' });
    expect(calls[0].channel).toBe('sms');
  });

  it('an email invitation still defaults to email, unchanged', async () => {
    const { svc, calls } = inviteHarness();
    await svc.createInvitation(ctx, { email: 'Tech@Salon.com', role: 'TECHNICIAN', tenantId: 'T1' });
    expect(calls[0]).toMatchObject({ email: 'tech@salon.com', phone: null, channel: 'email' });
  });

  it('an invitation addressed to nobody is refused — the DB check would reject it anyway', async () => {
    const { svc } = inviteHarness();
    await expect(svc.createInvitation(ctx, { role: 'TECHNICIAN', tenantId: 'T1' }))
      .rejects.toThrow(/email address or a phone number/i);
  });
});
