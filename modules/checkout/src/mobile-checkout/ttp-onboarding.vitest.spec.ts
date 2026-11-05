import { describe, it, expect, afterEach } from 'vitest';
import { isTenantTtpOnboarded, tenantTapToPayConfigured, validateOnboardingInput, InMemoryTtpOnboardingStore, type TtpOnboardingRecord } from './ttp-onboarding';
import { MobileCheckoutService, AttemptError } from './mobile-checkout.service';
import type { Ctx } from '@aipowersalon/permissions';

const rec = (a: TtpOnboardingRecord['appleEntitlementStatus'], c: TtpOnboardingRecord['commerceHubStatus']): TtpOnboardingRecord => ({ appleEntitlementStatus: a, commerceHubStatus: c });

describe('Tap to Pay onboarding — pure flip', () => {
  it('isTenantTtpOnboarded is true ONLY when Apple approved AND CommerceHub active', () => {
    expect(isTenantTtpOnboarded(rec('approved', 'active'))).toBe(true);
    expect(isTenantTtpOnboarded(rec('approved', 'onboarding'))).toBe(false);
    expect(isTenantTtpOnboarded(rec('requested', 'active'))).toBe(false);
    expect(isTenantTtpOnboarded(rec('rejected', 'suspended'))).toBe(false);
    expect(isTenantTtpOnboarded(null)).toBe(false);
  });

  it('tenantTapToPayConfigured needs BOTH credentials present AND recorded onboarding', () => {
    expect(tenantTapToPayConfigured(true, rec('approved', 'active'))).toBe(true);   // creds + onboarded
    expect(tenantTapToPayConfigured(false, rec('approved', 'active'))).toBe(false);  // onboarded but no creds
    expect(tenantTapToPayConfigured(true, rec('requested', 'onboarding'))).toBe(false); // creds but not onboarded
    expect(tenantTapToPayConfigured(true, null)).toBe(false);                        // creds but no record
    expect(tenantTapToPayConfigured(false, null)).toBe(false);
  });

  it('rejects unknown status values', () => {
    expect(() => validateOnboardingInput({ appleEntitlementStatus: 'bogus' as any, commerceHubStatus: 'active' })).toThrow();
    expect(() => validateOnboardingInput({ appleEntitlementStatus: 'approved', commerceHubStatus: 'live' as any })).toThrow();
  });
});

describe('InMemoryTtpOnboardingStore', () => {
  it('round-trips a record per tenant', async () => {
    const s = new InMemoryTtpOnboardingStore();
    expect(await s.get('T1')).toBeNull();
    await s.set('T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'active', notes: 'go-live' });
    const r = await s.get('T1');
    expect(r).toMatchObject({ appleEntitlementStatus: 'approved', commerceHubStatus: 'active', notes: 'go-live' });
    expect(await s.get('T2')).toBeNull(); // isolated per tenant
  });
});

// ── Service readiness flip. getReadiness only touches db (truthiness), gateways.resolve, and onboarding.get, so the
//    other deps are stubs. The Tap to Pay flip is observed on the 'tap_to_pay' CHECK state (the overall status is
//    intentionally masked by the honest deviceApproved:false until the device-approval lifecycle ships).
const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
const setCreds = (on: boolean) => { for (const k of Object.keys(TTP_ENV)) { if (on) process.env[k] = (TTP_ENV as any)[k]; else delete process.env[k]; } };
const buildSvc = (onboarding: InMemoryTtpOnboardingStore) => {
  const gateways: any = { resolve: async () => ({ status: 'active', configured: true }) };
  return new MobileCheckoutService({} as any, gateways, {} as any, {} as any, {} as any, onboarding);
};
const ctx = (role: string): Ctx => ({ tenantId: 'T1', branchId: 'B1', userId: 'u1', role, permissions: [] });
const tapState = (r: { checks: { key: string; state: string }[] }) => r.checks.find((c) => c.key === 'tap_to_pay')!.state;

afterEach(() => setCreds(false));

describe('MobileCheckoutService — Tap to Pay readiness flip', () => {
  it('stays setup_required with credentials but NO onboarding record', async () => {
    setCreds(true);
    const svc = buildSvc(new InMemoryTtpOnboardingStore());
    expect(tapState(await svc.getReadiness(ctx('MANAGER')))).toBe('setup_required');
  });

  it('flips to ok ONLY when credentials are present AND the tenant is recorded onboarded', async () => {
    const store = new InMemoryTtpOnboardingStore();
    await store.set('T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
    const svc = buildSvc(store);

    setCreds(false); // onboarded but creds missing → still blocked
    expect(tapState(await svc.getReadiness(ctx('MANAGER')))).toBe('setup_required');

    setCreds(true);  // creds + onboarded → flips on
    expect(tapState(await svc.getReadiness(ctx('MANAGER')))).toBe('ok');
  });

  it('stays setup_required when onboarding is only partial', async () => {
    setCreds(true);
    const store = new InMemoryTtpOnboardingStore();
    await store.set('T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'onboarding' });
    expect(tapState(await buildSvc(store).getReadiness(ctx('MANAGER')))).toBe('setup_required');
  });

  it('only a SUPER_ADMIN can record onboarding; the flip then reflects it', async () => {
    const store = new InMemoryTtpOnboardingStore();
    const svc = buildSvc(store);
    await expect(svc.setTapToPayOnboarding(ctx('MANAGER'), 'T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' })).rejects.toBeInstanceOf(AttemptError);
    await svc.setTapToPayOnboarding(ctx('SUPER_ADMIN'), 'T1', { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
    setCreds(true);
    expect(tapState(await svc.getReadiness(ctx('MANAGER')))).toBe('ok');
    const status = await svc.getTapToPayOnboardingForTenant('T1');
    expect(status).toMatchObject({ onboarded: true, credentialsPresent: true, appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
  });
});
