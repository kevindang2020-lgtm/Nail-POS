// report-delivery.pgtest.vitest.spec.ts — Daily Summary Email / Schedule Report on the migrated schema (migration 845):
// own address only, honest outcomes, per-hour cap, self-consented schedules sent once per occurrence, skipped when the
// person lost access, salon-isolated.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MockEmailSender, NotConfiguredEmailSender } from '@aipowersalon/notifications';
import { sessionPermissionsForRole } from '@aipowersalon/permissions';
import { ReportDeliveryService } from './report-delivery.service';
import { dueOccurrence, scheduledPeriod, renderDailySummaryEmail } from './report-delivery.dto';

const T1 = 'c5450000-0000-4000-8000-000000000001'; const T2 = 'c5450000-0000-4000-8000-000000000002';
const OWNER = 'c5450000-0000-4000-8000-0000000000a1'; const TECH = 'c5450000-0000-4000-8000-0000000000a2'; const GONE = 'c5450000-0000-4000-8000-0000000000a3';
const OTHER = 'c5450000-0000-4000-8000-0000000000b1';
const KPIS = { grossSalesCents: 32200, netSalesCents: 30400, serviceSalesCents: 31000, productSalesCents: 1200, tipsCents: 3000, taxCollectedCents: 2014, cardSurchargeCents: 0, discountsCents: 1800, refundsCents: 2700, ticketsCount: 4, customersCount: 4, averageTicketCents: 8050 };
const ALL = ['pos.reports.view', 'pos.reports.financial_view', 'pos.reports.export'];
let db: any; const calls: any[] = [];
const reports = { getSales: async (ctx: any, f: any) => { calls.push({ ctx, f }); return { kpis: KPIS, trend: { points: [] } }; } } as any;
const ctx = (userId = OWNER, permissions = ALL, tenantId = T1) => ({ tenantId, branchId: '', userId, role: 'OWNER', permissions });

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [id, slug] of [[T1, 'rd1'], [T2, 'rd2']]) await db.insertInto('tenants').values({ id, legal_name: slug, display_name: slug === 'rd1' ? 'Rose Nails' : 'Other', tenant_slug: slug, tenant_code: slug.toUpperCase(), status: 'active' } as any).execute();
  const u = (id: string, t: string, email: string | null, role: string, status = 'active') => ({ id, tenant_id: t, first_name: 'A', last_name: 'B', full_name: 'A B', email, password_hash: 'x', status, role });
  await db.insertInto('users').values([u(OWNER, T1, 'owner@rose.test', 'OWNER'), u(TECH, T1, 'tech@rose.test', 'TECHNICIAN'), u(GONE, T1, 'gone@rose.test', 'MANAGER', 'inactive'), u(OTHER, T2, 'o@other.test', 'OWNER')] as any).execute();
}, 180_000);

describe('Email Report (send to me now)', () => {
  it('goes to my own address only, with the Sales Report figures for the period; simulated without a provider; logged', async () => {
    const mail = new MockEmailSender();
    const svc = new ReportDeliveryService(db, reports, mail);
    const r = await svc.sendNow(ctx(), { from: '2026-11-09', to: '2026-11-09' });
    expect(r.status).toBe('simulated');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('owner@rose.test');
    expect(mail.sent[0].subject).toBe('Rose Nails — Daily Summary, Mon, Nov 9, 2026');
    expect(mail.sent[0].body).toContain('$304.00');
    expect(calls.at(-1).f).toEqual({ from: '2026-11-09', to: '2026-11-09', preset: 'custom' });
    const st = await svc.state(ctx());
    expect(st.email).toBe('o***@rose.test'); expect(st.sender).toBe('simulated');
    expect(st.deliveries[0]).toMatchObject({ kind: 'now', status: 'simulated', periodFrom: '2026-11-09', periodTo: '2026-11-09' });
  });
  it('production without a provider: not_configured, nothing sent', async () => {
    const svc = new ReportDeliveryService(db, reports, new NotConfiguredEmailSender());
    const r = await svc.sendNow(ctx(TECH, ALL), { from: '2026-11-01', to: '2026-11-07' });
    expect(r.status).toBe('not_configured');
  });
  it('refuses without financial / export permission, bad ranges, and a sixth send in an hour', async () => {
    const svc = new ReportDeliveryService(db, reports, new MockEmailSender());
    await expect(svc.sendNow(ctx(OWNER, ['pos.reports.view']), { from: '2026-11-09', to: '2026-11-09' })).rejects.toMatchObject({ status: 403 });
    await expect(svc.sendNow(ctx(), { from: '2026-11-09', to: '2026-11-01' })).rejects.toMatchObject({ apiCode: 'DATE_RANGE_INVALID' });
    await expect(svc.sendNow(ctx(), { from: '2026-01-01', to: '2026-11-01' })).rejects.toMatchObject({ apiCode: 'DATE_RANGE_TOO_LARGE' });
    for (let i = 0; i < 4; i++) await svc.sendNow(ctx(), { from: '2026-11-09', to: '2026-11-09' });   // 1 earlier + 4 = 5
    await expect(svc.sendNow(ctx(), { from: '2026-11-09', to: '2026-11-09' })).rejects.toMatchObject({ status: 429, apiCode: 'RATE_LIMITED' });
  });
});

describe('Schedule Report (my daily / weekly e-mail)', () => {
  // Tue Nov 10 2026, 08:30 in New York (13:30Z) — past a 07:00 send hour; the default salon zone is America/New_York
  const at = (iso: string) => () => new Date(iso);
  it('I schedule myself; the job sends yesterday once per occurrence; off stops it; other salons untouched', async () => {
    const mail = new MockEmailSender();
    const svc = new ReportDeliveryService(db, reports, mail, at('2026-11-10T13:30:00Z'));
    const st = await svc.subscribe(ctx(), { frequency: 'daily', sendAt: '07:00' });
    expect(st.subscription).toMatchObject({ frequency: 'daily', sendAt: '07:00', active: true });
    await svc.subscribe(ctx(OTHER, ALL, T2), { frequency: 'weekly', sendAt: '07:00' });   // Tuesday: weekly is not due
    const r1 = await svc.tick(sessionPermissionsForRole);
    expect(r1).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(mail.sent.map((m) => m.to)).toEqual(['owner@rose.test']);
    expect(mail.sent[0].subject).toContain('Mon, Nov 9, 2026');
    expect(mail.sent[0].body).toContain('You receive this because you turned on Schedule Report');
    expect(await svc.tick(sessionPermissionsForRole)).toEqual({ sent: 0, skipped: 0, failed: 0 });   // same occurrence: nothing twice
    await svc.unsubscribe(ctx());
    const svc2 = new ReportDeliveryService(db, reports, mail, at('2026-11-11T13:30:00Z'));
    expect((await svc2.tick(sessionPermissionsForRole)).sent).toBe(0);
    expect((await svc.state(ctx())).subscription?.active).toBe(false);
  });
  it('before the send hour nothing is due; a person who lost access is skipped and logged, not e-mailed', async () => {
    const mail = new MockEmailSender();
    const early = new ReportDeliveryService(db, reports, mail, at('2026-11-12T10:30:00Z'));   // 05:30 New York
    await early.subscribe(ctx(), { frequency: 'daily', sendAt: '07:00' });
    expect((await early.tick(sessionPermissionsForRole)).sent).toBe(0);
    // a technician / an inactive account that somehow holds a schedule row is skipped at send time
    await db.insertInto('report_email_subscriptions').values([{ tenant_id: T1, owner_user_id: TECH, frequency: 'daily', send_at: '07:00' }, { tenant_id: T1, owner_user_id: GONE, frequency: 'daily', send_at: '07:00' }] as any).execute();
    const late = new ReportDeliveryService(db, reports, mail, at('2026-11-12T13:30:00Z'));
    expect(await late.tick(sessionPermissionsForRole)).toEqual({ sent: 1, skipped: 2, failed: 0 });
    expect(mail.sent.map((m) => m.to)).toEqual(['owner@rose.test']);
    const skipped = await db.selectFrom('report_email_deliveries').select(['owner_user_id', 'status', 'detail']).where('status', '=', 'skipped').execute();
    expect(skipped.map((s: any) => s.owner_user_id).sort()).toEqual([TECH, GONE].sort());
  });
});

describe('pure rules', () => {
  it('weekly sends on the salon\'s Monday for the last Monday–Sunday; daily covers yesterday; the hour is the salon\'s', () => {
    expect(scheduledPeriod('weekly', new Date('2026-11-09T15:00:00Z'), 'America/New_York')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(scheduledPeriod('weekly', new Date('2026-11-10T15:00:00Z'), 'America/New_York')).toBeNull();
    expect(scheduledPeriod('daily', new Date('2026-11-10T03:00:00Z'), 'America/New_York')).toEqual({ from: '2026-11-08', to: '2026-11-08' });   // still Nov 9 in New York
    expect(dueOccurrence({ id: 's', frequency: 'daily', sendAt: '07:00' }, new Date('2026-11-10T11:59:00Z'), 'America/New_York')).toBeNull();
    expect(dueOccurrence({ id: 's', frequency: 'daily', sendAt: '07:00' }, new Date('2026-11-10T12:00:00Z'), 'America/New_York')).toEqual({ from: '2026-11-09', to: '2026-11-09', key: 's:2026-11-09' });
  });
  it('the e-mail escapes the salon name and shows N/A for an average with no tickets', () => {
    const m = renderDailySummaryEmail({ salonName: '<b>X</b>', from: '2026-11-09', to: '2026-11-09', kpis: { ...KPIS, ticketsCount: 0, averageTicketCents: 0 }, scheduled: false });
    expect(m.html).toContain('&lt;b&gt;X&lt;/b&gt;'); expect(m.html).not.toContain('<b>X</b>'); expect(m.html).toContain('N/A');
  });
});
