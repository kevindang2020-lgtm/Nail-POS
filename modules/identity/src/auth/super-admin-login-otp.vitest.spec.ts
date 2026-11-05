import { describe, it, expect } from 'vitest';
import { SuperAdminOtpService, InMemorySuperAdminOtpStore, maskPhone } from './super-admin-login-otp';
import { MockSmsSender } from '@aipowersalon/notifications';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed } from './auth-user.repository';
import { hashPassword } from '@aipowersalon/auth';

const codeFrom = (body: string): string => (body.match(/verification code is:\s*(\d{6})/)?.[1]) ?? '';

describe('SuperAdminOtpService', () => {
  it('generates a 6-digit code, stores only its HASH, and SMSes the plaintext to the phone', async () => {
    const store = new InMemorySuperAdminOtpStore();
    const sms = new MockSmsSender();
    const otp = new SuperAdminOtpService(store, sms);
    const { maskedPhone } = await otp.issueAndSend('u1', '+15125550199');
    expect(maskedPhone).toBe('(***) ***-0199');
    expect(sms.sent).toHaveLength(1);
    const code = codeFrom(sms.sent[0].body);
    expect(code).toMatch(/^\d{6}$/);
    const active = await store.getActive('u1', Date.now());
    expect(active?.codeHash).toBeTruthy();
    expect(active?.codeHash).not.toContain(code); // stored value is a hash, never the code
  });

  it('verifies the correct code once (single-use), and rejects reuse', async () => {
    const store = new InMemorySuperAdminOtpStore(); const sms = new MockSmsSender();
    const otp = new SuperAdminOtpService(store, sms);
    await otp.issueAndSend('u1', '+15125550199');
    const code = codeFrom(sms.sent[0].body);
    expect(await otp.verify('u1', code)).toBe(true);
    expect(await otp.verify('u1', code)).toBe(false); // consumed — cannot be replayed
  });

  it('rejects a wrong code and locks after 5 attempts', async () => {
    const store = new InMemorySuperAdminOtpStore(); const sms = new MockSmsSender();
    const otp = new SuperAdminOtpService(store, sms);
    await otp.issueAndSend('u1', '+15125550199');
    const code = codeFrom(sms.sent[0].body);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(await otp.verify('u1', wrong)).toBe(false);
    expect(await otp.verify('u1', code)).toBe(false); // locked — even the correct code no longer works
  });

  it('rejects an expired code', async () => {
    let now = 1_000_000;
    const store = new InMemorySuperAdminOtpStore(); const sms = new MockSmsSender();
    const otp = new SuperAdminOtpService(store, sms, () => now);
    await otp.issueAndSend('u1', '+15125550199');
    const code = codeFrom(sms.sent[0].body);
    now += 5 * 60_000 + 1; // past the 5-minute TTL
    expect(await otp.verify('u1', code)).toBe(false);
  });

  it('reuses a freshly-sent code instead of re-sending (SMS-bomb / double-submit guard)', async () => {
    let now = 1_000_000;
    const store = new InMemorySuperAdminOtpStore(); const sms = new MockSmsSender();
    const otp = new SuperAdminOtpService(store, sms, () => now);
    await otp.issueAndSend('u1', '+15125550199');
    now += 5_000; // within the 30s cooldown
    await otp.issueAndSend('u1', '+15125550199');
    expect(sms.sent).toHaveLength(1); // second call did NOT send another text
  });

  it('masks all but the last four digits', () => {
    expect(maskPhone('+1 (512) 555-4829')).toBe('(***) ***-4829');
  });
});

describe('LoginService — super-admin SMS OTP (mandatory second factor)', () => {
  const PW = 'Sup3rSecret!';
  const buildSvc = async () => {
    const hash = await hashPassword(PW);
    const seed: AuthSeed = {
      tenants: [], subscriptions: [], branches: [],
      users: [{ userId: 'uRoot', tenantId: null, branchId: null, role: 'SUPER_ADMIN', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: 'Root', email: 'root@aips.com', normalizedPhone: '+15125554829' } as any],
    };
    const repo = new InMemoryAuthUserRepository(seed);
    const sms = new MockSmsSender();
    const otp = new SuperAdminOtpService(new InMemorySuperAdminOtpStore(), sms);
    return { svc: new LoginService(repo, undefined, undefined, otp), sms };
  };

  it('sends an SMS code and returns MFA_REQUIRED + masked phone, then SUCCESS with the code', async () => {
    const { svc, sms } = await buildSvc();
    const step1 = await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: PW });
    expect(step1.outcome).toBe('MFA_REQUIRED');
    expect(step1.maskedPhone).toBe('(***) ***-4829');
    expect(sms.sent).toHaveLength(1);
    const code = codeFrom(sms.sent[0].body);
    const step2 = await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: PW, mfaCode: code });
    expect(step2.outcome).toBe('SUCCESS');
    expect(step2.principal?.role).toBe('SUPER_ADMIN');
  });

  it('a wrong code stays at MFA_REQUIRED (no bypass)', async () => {
    const { svc, sms } = await buildSvc();
    await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: PW });
    const code = codeFrom(sms.sent[0].body);
    const wrong = code === '000000' ? '111111' : '000000';
    const r = await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: PW, mfaCode: wrong });
    expect(r.outcome).toBe('MFA_REQUIRED');
    expect(r.principal).toBeUndefined();
  });

  it('never sends a code for a WRONG password', async () => {
    const { svc, sms } = await buildSvc();
    const r = await svc.attempt({ portal: 'super-admin', identifier: 'root@aips.com', password: 'nope' });
    expect(r.outcome).not.toBe('SUCCESS');
    expect(sms.sent).toHaveLength(0);
  });
});
