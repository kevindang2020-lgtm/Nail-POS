// Tenant-warning dispatch — pure status resolution + job honest semantics (sent/skipped/failed) + env gate.
import { describe, it, expect, vi } from 'vitest';
import { resolveDeliveryStatus, warningEmail, warningSmsBody } from './tenant-warning-dispatch-core';
import { TenantWarningDispatchJob, InMemoryTenantWarningDispatchRepo, tenantWarningDispatchEnabled, warningDispatchTick, type PendingWarning } from './tenant-warning-dispatch.job';

const W = (over: Partial<PendingWarning> = {}): PendingWarning => ({
  id: 'w1', tenantId: 't1', subject: 'Overdue balance', message: 'Please settle your outstanding balance.',
  sendEmail: true, sendSms: false, ownerEmail: 'owner@example.com', ownerPhone: '+15555550100', ...over,
});

describe('tenant-warning-dispatch core', () => {
  it('resolves the honest terminal status', () => {
    expect(resolveDeliveryStatus({})).toBe('recorded');
    expect(resolveDeliveryStatus({ email: 'sent' })).toBe('sent');
    expect(resolveDeliveryStatus({ email: 'skipped' })).toBe('skipped');
    expect(resolveDeliveryStatus({ email: 'sent', sms: 'skipped' })).toBe('sent');
    expect(resolveDeliveryStatus({ email: 'failed', sms: 'sent' })).toBe('failed'); // failure surfaces over success
    expect(resolveDeliveryStatus({ email: 'skipped', sms: 'skipped' })).toBe('skipped');
  });
  it('builds channel bodies and truncates long SMS', () => {
    expect(warningEmail('Notice', 'Body').subject).toBe('AIPowerSalon: Notice');
    expect(warningSmsBody('S', 'M')).toContain('AIPowerSalon notice — S: M');
    expect(warningSmsBody('S', 'x'.repeat(500)).length).toBe(320);
  });
});

describe('TenantWarningDispatchJob', () => {
  it('sends over configured channels and marks sent', async () => {
    const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: true, sendSms: true })]);
    const email = { send: vi.fn().mockResolvedValue({ id: 'e1' }) };
    const sms = { send: vi.fn().mockResolvedValue({ sid: 's1' }) };
    const sum = await new TenantWarningDispatchJob(repo, email, sms).dispatchPending();
    expect(sum).toEqual({ processed: 1, sent: 1, skipped: 0, failed: 0 });
    expect(email.send).toHaveBeenCalledOnce(); expect(sms.send).toHaveBeenCalledOnce();
    expect(repo.marked.w1).toBe('sent');
  });
  it('skips (never fakes) when a provider is absent', async () => {
    const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: true, sendSms: true })]);
    const sum = await new TenantWarningDispatchJob(repo, null, null).dispatchPending(); // no creds
    expect(sum).toEqual({ processed: 1, sent: 0, skipped: 1, failed: 0 });
    expect(repo.marked.w1).toBe('skipped');
  });
  it('skips a channel with no recipient', async () => {
    const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: true, sendSms: false, ownerEmail: null })]);
    const email = { send: vi.fn() };
    const sum = await new TenantWarningDispatchJob(repo, email, null).dispatchPending();
    expect(email.send).not.toHaveBeenCalled();
    expect(repo.marked.w1).toBe('skipped'); expect(sum.skipped).toBe(1);
  });
  it('marks failed when a send throws', async () => {
    const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: true, sendSms: false })]);
    const email = { send: vi.fn().mockRejectedValue(new Error('email_failed:500')) };
    const sum = await new TenantWarningDispatchJob(repo, email, null).dispatchPending();
    expect(repo.marked.w1).toBe('failed'); expect(sum.failed).toBe(1);
  });
  it('is idempotent across the batch boundary (only pending rows are listed)', async () => {
    const repo = new InMemoryTenantWarningDispatchRepo([W({ id: 'a' }), W({ id: 'b', sendEmail: false, sendSms: true })]);
    const email = { send: vi.fn().mockResolvedValue({ id: 'e' }) };
    const sms = { send: vi.fn().mockResolvedValue({ sid: 's' }) };
    const sum = await new TenantWarningDispatchJob(repo, email, sms).dispatchPending();
    expect(sum.processed).toBe(2); expect(repo.marked.a).toBe('sent'); expect(repo.marked.b).toBe('sent');
  });

  it('env gate + tick are off/safe by default', async () => {
    for (const v of ['1', 'true', 'on', 'yes']) expect(tenantWarningDispatchEnabled({ TENANT_WARNING_DISPATCH_CRON_ENABLED: v } as any)).toBe(true);
    expect(tenantWarningDispatchEnabled({} as any)).toBe(false);
    const repo = new InMemoryTenantWarningDispatchRepo([W()]);
    const job = new TenantWarningDispatchJob(repo, { send: vi.fn().mockResolvedValue({ id: 'e' }) }, null);
    const errs: string[] = [];
    const s = await warningDispatchTick(job, { log: () => {}, error: (m) => errs.push(m) });
    expect(s?.processed).toBe(1); expect(errs).toHaveLength(0);
  });
});

describe('owner notification switches (decision Nov 13 2026: high / critical always go; low / medium follow the switch)', () => {
  const senders = () => ({ email: { send: vi.fn().mockResolvedValue({ id: 'e1' }) }, sms: { send: vi.fn().mockResolvedValue({ id: 's1' }) } });
  const smsOff = vi.fn(async (_t: string, _u: string, ch: 'sms' | 'email') => ch !== 'sms');   // the owner switched SMS off
  it('a medium warning skips SMS when the owner switched SMS off, still e-mails, and counts the hold', async () => {
    const s = senders();
    const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: true, sendSms: true, severity: 'medium', ownerUserId: 'u1' })]);
    const sum = await new TenantWarningDispatchJob(repo, s.email as any, s.sms as any, smsOff).dispatchPending();
    expect(s.email.send).toHaveBeenCalledTimes(1);
    expect(s.sms.send).not.toHaveBeenCalled();
    expect(smsOff).toHaveBeenCalledWith('t1', 'u1', 'sms', 'account_notice');
    expect(sum.heldForOwnerPref).toBe(1);
    expect(repo.marked.w1).toBe('sent');
  });
  it('a low warning held on its only channel is recorded as skipped (never faked as sent)', async () => {
    const s = senders();
    const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: false, sendSms: true, severity: 'low', ownerUserId: 'u1' })]);
    await new TenantWarningDispatchJob(repo, s.email as any, s.sms as any, smsOff).dispatchPending();
    expect(s.sms.send).not.toHaveBeenCalled();
    expect(repo.marked.w1).toBe('skipped');
  });
  it('high and critical warnings go even with the switch off — the switch is not even asked', async () => {
    for (const severity of ['high', 'critical']) {
      const s = senders(); const ask = vi.fn(async () => false);
      const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: true, sendSms: true, severity, ownerUserId: 'u1' })]);
      await new TenantWarningDispatchJob(repo, s.email as any, s.sms as any, ask).dispatchPending();
      expect(s.email.send).toHaveBeenCalledTimes(1);
      expect(s.sms.send).toHaveBeenCalledTimes(1);
      expect(ask).not.toHaveBeenCalled();
    }
  });
  it('no owner on file or no preference port → sent exactly as before', async () => {
    const s = senders();
    const repo = new InMemoryTenantWarningDispatchRepo([W({ sendEmail: true, sendSms: true, severity: 'low', ownerUserId: null })]);
    await new TenantWarningDispatchJob(repo, s.email as any, s.sms as any, smsOff).dispatchPending();
    expect(s.sms.send).toHaveBeenCalledTimes(1);
  });
});
