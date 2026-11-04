// membership-renewal.scheduler — w4 sweep SW-17 (Oct 13 2026): NOTHING ran membership renewals or renewal reminders.
// The only entry was POST /internal/membership-billing/run-renewals (and run-reminders), a secret-guarded endpoint meant
// for an external cron — and no cron, worker or in-app scheduler called it (UNUSED_ROUTE_INVENTORY lists it; the boot
// wiring check found no membership scheduler among the 61 background classes). Auto-renewing memberships never renewed.
// The scheduler runs the SAME two service calls the endpoint runs, single-owner (runTick), behind
// MEMBERSHIP_RENEWALS_CRON_ENABLED (off by default like HARDWARE_PAYMENT_CRON_ENABLED, so dev/CI never auto-charge;
// charging itself still needs MEMBERSHIP_AUTOBILL_ENABLED — without it the sweep reports not_configured).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MembershipRenewalScheduler, membershipRenewalsCronEnabled } from './membership-renewal.scheduler';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.useRealTimers(); });

const fakes = () => {
  const calls: string[] = [];
  const billing = { runDueRenewals: vi.fn(async (_now: Date, limit: number) => { calls.push(`renewals:${limit}`); return { due: 0, succeeded: 0, failed: 0, notConfigured: 0, results: [] }; }),
    expireAgedCredits: vi.fn(async () => { calls.push('credit-expiry'); return 0; }) };
  const comms = { runRenewalRemindersDue: vi.fn(async (_now: Date, days: number) => { calls.push(`reminders:${days}`); return { sent: 0, skipped: 0 }; }) };
  return { calls, billing, comms };
};

describe('membership renewals are actually run', () => {
  it('the flag is OFF unless set (dev / CI never auto-charge)', () => {
    delete process.env.MEMBERSHIP_RENEWALS_CRON_ENABLED;
    expect(membershipRenewalsCronEnabled()).toBe(false);
    expect(membershipRenewalsCronEnabled({ MEMBERSHIP_RENEWALS_CRON_ENABLED: '1' } as any)).toBe(true);
  });
  it('one tick runs the renewal reminders and then the due renewals — the same calls the internal endpoint makes', async () => {
    const f = fakes();
    const s = new MembershipRenewalScheduler(f.billing as any, f.comms as any);
    await s.tick(new Date(Date.UTC(2026, 9, 13, 14)));
    expect(f.calls).toEqual(['reminders:7', 'renewals:100', 'credit-expiry']);   // Nov 4 2026: the plans' credit expiry (days) runs with the renewals
  });
  it('armed only when the flag is on (and this process runs critical jobs)', () => {
    vi.useFakeTimers();
    const f = fakes();
    delete process.env.PROCESS_ROLE;
    process.env.MEMBERSHIP_RENEWALS_CRON_ENABLED = '0';
    const off = new MembershipRenewalScheduler(f.billing as any, f.comms as any); off.onModuleInit();
    expect(off.armed).toBe(false);
    process.env.MEMBERSHIP_RENEWALS_CRON_ENABLED = '1';
    const on = new MembershipRenewalScheduler(f.billing as any, f.comms as any); on.onModuleInit();
    expect(on.armed).toBe(true);
    on.onModuleDestroy();
  });
});
