// consent-boundary.pgtest — Phone & Messaging 12 "Consent Boundary Checker" (Kevin, Nov 12 2026): pins what STOP does today.
// Booking verification codes and account texts still go out to a number that texted STOP; every other text purpose is
// blocked; the checker's rule table says exactly what the send path does, and its evidence comes from the ledger.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MockSmsSender, MockEmailSender } from '@aipowersalon/notifications';
import { NotificationsService } from './notifications.service';
import { KyselyNotificationsRepository } from './notifications.kysely.repository';
import { KyselyOptOutRepository } from './notifications.optout.kysely.repository';
import { CONSENT_BOUNDARY, consentBoundary, smsStopExempt } from './consent-boundary';

const P = 'c0b30000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), X = id('a2'), B = id('b1'), BX = id('b2');
const STOPPED = '+16095550301', OK = '+16095550302';
let db: any; let svc: NotificationsService; let sms: MockSmsSender;
const q = async (s: any) => (await s.execute(db)).rows as any[];

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'CB LLC', 'Consent', 'cb-a', 'CBA001', 'active'), (${X}, 'X LLC', 'Other', 'cb-b', 'CBB001', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  sms = new MockSmsSender();
  const optOut = new KyselyOptOutRepository(db);
  svc = new NotificationsService(new KyselyNotificationsRepository(db), sms as any, new MockEmailSender() as any, undefined, optOut);
  await optOut.optOut(T, 'sms', STOPPED, 'inbound_stop', { source: 'inbound_stop' } as any);
  await optOut.optOut(X, 'sms', STOPPED, 'inbound_stop', { source: 'inbound_stop' } as any);
}, 240_000);

describe('Consent Boundary Checker (Phone & Messaging 12)', () => {
  it('the send path does exactly what the rule table says for every text purpose sent to a number that texted STOP', async () => {
    const textRules = CONSENT_BOUNDARY.filter((r) => r.channel === 'sms' && r.path === 'notifications');
    expect(textRules.map((r) => r.purpose)).toEqual(['account', 'receipt', 'reminder', 'notification', 'conversation', 'followup', 'marketing']);
    for (const r of textRules) {
      const res = await svc.sendSms({ tenantId: T, branchId: B, to: STOPPED, body: `msg ${r.purpose}`, purpose: r.purpose as any });
      expect({ purpose: r.purpose, sent: res.sent }).toEqual({ purpose: r.purpose, sent: !r.blockedByOptOut });
      if (r.blockedByOptOut) expect(res).toMatchObject({ status: 'blocked', reason: 'opted_out' });
      const ok = await svc.sendSms({ tenantId: T, branchId: B, to: OK, body: `msg ${r.purpose}`, purpose: r.purpose as any });
      expect(ok.sent).toBe(true);                                                              // a number that never texted STOP gets everything
    }
    expect(smsStopExempt('account')).toBe(true); expect(smsStopExempt('followup')).toBe(false); expect(smsStopExempt('marketing')).toBe(false);
  });
  it('booking verification codes are transactional: not blocked by STOP and sent through the Verify service, not the ledger', () => {
    const code = CONSENT_BOUNDARY.find((r) => r.kind === 'booking_code')!;
    expect(code).toMatchObject({ channel: 'sms', blockedByOptOut: false, basis: 'transactional', path: 'verify_service', purpose: null });
    expect(CONSENT_BOUNDARY.find((r) => r.kind === 'marketing')).toMatchObject({ blockedByOptOut: true, basis: 'marketing' });
    expect(CONSENT_BOUNDARY.find((r) => r.kind === 'followup')).toMatchObject({ blockedByOptOut: true });
  });
  it('the checker reads this salon\'s evidence from the ledger (blocked vs sent to an opted-out number), flags a breach, never another salon; writes nothing', async () => {
    const before = (await q(sql`select (select count(*) from notifications) + (select count(*) from notification_opt_outs) as n`))[0].n;
    const c = await consentBoundary(db, T);
    expect(c.optedOut.sms).toBe(1);
    const by = Object.fromEntries(c.rules.map((r) => [r.kind, r]));
    expect(by.booking_code).toMatchObject({ state: 'not_on_ledger', last30Days: null });
    expect(by.account).toMatchObject({ state: 'consistent', last30Days: { blocked: 0, sentToOptedOut: 1 } });   // allowed: the customer asked for it
    expect(by.marketing).toMatchObject({ state: 'consistent', last30Days: { blocked: 1, sentToOptedOut: 0 } });
    expect(by.followup.last30Days).toEqual({ blocked: 1, sentToOptedOut: 0 });
    expect(c.overall).toBe('consistent');
    // a reminder that reached the opted-out number (e.g. an old code path) is shown as a breach
    await q(sql`insert into notifications (tenant_id, channel, to_address, body, status, purpose, branch_id, created_at) values (${T}, 'sms', ${STOPPED}, 'x', 'sent', 'reminder', ${B}, now())`);
    const c2 = await consentBoundary(db, T);
    expect(c2.rules.find((r) => r.kind === 'reminder')).toMatchObject({ state: 'breach', last30Days: { sentToOptedOut: 1 } });
    expect(c2.overall).toBe('breach');
    const other = await consentBoundary(db, X);
    expect(other.overall).toBe('consistent'); expect(other.rules.every((r) => !r.last30Days || (r.last30Days.blocked === 0 && r.last30Days.sentToOptedOut === 0))).toBe(true);
    expect((await q(sql`select (select count(*) from notifications) + (select count(*) from notification_opt_outs) as n`))[0].n).toBe(Number(before) + 1);   // only the row this test planted
  });
});
