// business-alert-incidents.pgtest — A2 AI Business Alerts "not built" parts (Nov 6 2026; migration 826) on the REAL schema:
// a trigger opens an incident and notifies per the rule (in-app inbox, email / SMS to recipients, quiet hours, cooldown,
// delivery log), the incident lifecycle (investigate / assign / snooze → wakes / resolve / reopen, versioned), escalation.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { join } from 'node:path';
import { migratedPglite, kyselyFor, applyMigrationToPglite } from '@aipowersalon/testing';
import { KyselyReportsRepository, ReportsService } from '@aipowersalon/reports';
import { BusinessCenter } from './business-center';
import { AiBusinessAlertsService } from './ai-business-alerts.service';
import { KyselyAlertsRepository } from './ai-business-alerts.kysely.repository';
import { AiBusinessAlertEvaluator } from './ai-business-alerts-evaluator';
import { AiBusinessRevenueService } from './ai-business-revenue.service';
import { AiBusinessAppointmentsService } from './ai-business-appointments.service';
import { BusinessAlertIncidents, AlertIncidentError, inQuiet, alertMessage, type AlertMessenger } from './business-alert-incidents';

const id = (n: number) => `82600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), OWNER = id(10), MGR = id(11), TECH = id(12), C = id(20);
const PERMS = ['pos.ai_business.view', 'pos.reports.view', 'pos.reports.financial_view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: PERMS, ...o });
let pg: any; let db: any; let bc: BusinessCenter; let inc: BusinessAlertIncidents; let alertsSvc: AiBusinessAlertsService;
let clock = Date.parse('2026-11-06T15:00:00Z');   // 15:00 UTC — the branch is UTC, quiet 21–8
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof AlertIncidentError ? e.code : (e?.code ?? e?.message); } }
let sent: any[] = [];
const messenger: AlertMessenger = {
  async sendSms(r) { sent.push({ ch: 'sms', ...r }); return { sent: true, status: 'sent', notificationId: 'n' + sent.length }; },
  async sendEmail(r) { sent.push({ ch: 'email', ...r }); return { sent: true, status: 'sent', notificationId: 'e' + sent.length }; },
};
let n = 0;
async function rule(o: { threshold?: number; title?: string } = {}) {
  const r: any = await alertsSvc.create(ctx(), { title: o.title ?? `Sales watch ${++n}`, metricId: 'net_sales', operator: 'gt', threshold: o.threshold ?? 100, preset: 'today', minSampleSize: 1 } as any);
  return String(r.id);
}

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`SET TIME ZONE 'UTC'`);
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','bc-826','BC826','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC')`, [B, T]);
  await q(`insert into users (id, tenant_id, full_name, email, normalized_phone, status, role) values
    ($1,$4,'Owner Kim','o@bc.test','+16095550001','active','OWNER'), ($2,$4,'Manager Lee','m@bc.test',null,'active','MANAGER'), ($3,$4,'Tech Ann','t@bc.test','+16095550003','active','TECHNICIAN')`, [OWNER, MGR, TECH, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Jen','W','Jen W')`, [C, T, B]);
  const t = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,'paid',5000,5000,'82601', now(), now()) returning id`, [T, B, C]))[0].id;
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status, created_at) values ($1,$2,$3,'card',5000,0,0,'approved', now())`, [T, B, t]);
  const sales = new ReportsService(new KyselyReportsRepository(db));
  const revenue = new AiBusinessRevenueService(sales);
  const appointments = new AiBusinessAppointmentsService(sales as any);
  alertsSvc = new AiBusinessAlertsService(new KyselyAlertsRepository(db), new AiBusinessAlertEvaluator({
    getRevenueSummary: (c, p) => revenue.getRevenueSummary(c, p) as any, getAppointmentMetrics: (c, p) => appointments.getAppointmentMetrics(c, p) as any, getCustomerGrowth: async () => ({ retentionRatePercent: 0, activeCustomers: 0 }),
  }));
  inc = new BusinessAlertIncidents(db, messenger, () => clock);
  bc = new BusinessCenter(db, { reports: {} as any, alerts: alertsSvc, revenue, appointments, sales, incidents: inc });
}, 180_000);
beforeEach(() => { sent = []; clock = Date.parse('2026-11-06T15:00:00Z'); });

describe('A2 — notifications on a trigger', () => {
  it('IN-01 in-app only (the default): a trigger opens an incident and lands in the Owner app Alerts inbox; nothing is texted', async () => {
    const a = await rule();
    const r: any = await bc.alertEvaluate(ctx(), a);
    expect(r.stateChange).toBe('triggered');
    expect(r.deliveries).toEqual([expect.objectContaining({ channel: 'in_app', status: 'sent' })]);
    const oa = await q(`select category, severity, title, metadata from owner_alerts where tenant_id = $1 and metadata->>'eventId' = $2`, [T, r.eventId]);
    expect(oa[0]).toMatchObject({ category: 'ai_business_alert', severity: 'warning' });
    expect(oa[0].title).toMatch(/^\[Warning\] Sales watch/);
    expect((await q(`select incident_status from ai_business_alert_events where id = $1`, [r.eventId]))[0].incident_status).toBe('open');
    expect(sent).toHaveLength(0);
    // an evaluation that stays triggered does not notify again
    const again: any = await bc.alertEvaluate(ctx(), a);
    expect(again.stateChange).toBe('unchanged'); expect(again.deliveries).toBeUndefined();
  });
  it('IN-02 email + SMS go to the salon owners and managers by default; a missing phone is a recorded skip, never "sent"', async () => {
    const a = await rule();
    await inc.setDelivery(ctx(), a, { severity: 'critical', channels: ['in_app', 'email', 'sms'] });
    const r: any = await bc.alertEvaluate(ctx(), a);
    expect(sent.map((s) => [s.ch, s.to]).sort()).toEqual([['email', 'm@bc.test'], ['email', 'o@bc.test'], ['sms', '+16095550001']]);
    expect(sent.every((s) => s.purpose === 'notification' && s.tenantId === T)).toBe(true);
    expect(sent[0].body).toMatch(/Net sales is \$50\.00 \(above \$1\.00\)/);
    expect(r.deliveries).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'sms', status: 'skipped', reason: 'no_phone' })]));
    expect(sent.some((s) => s.to === 't@bc.test')).toBe(false);                     // a technician is not a default recipient
  });
  it('IN-03 named recipients replace the default; quiet hours hold email / SMS (recorded) while in-app still lands', async () => {
    const a = await rule();
    await inc.setDelivery(ctx(), a, { channels: ['in_app', 'sms'], recipientUserIds: [TECH] });
    clock = Date.parse('2026-11-06T22:30:00Z');                                       // 22:30 at the branch
    const r: any = await bc.alertEvaluate(ctx(), a);
    expect(sent).toHaveLength(0);
    expect(r.deliveries).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'in_app', status: 'sent' }), expect.objectContaining({ channel: 'sms', status: 'skipped', reason: 'quiet_hours', recipient: '+16095550003' })]));
    expect(inQuiet(new Date('2026-11-06T22:30:00Z'), 21, 8, 'UTC')).toBe(true);
    expect(inQuiet(new Date('2026-11-06T22:30:00Z'), 9, 9, 'UTC')).toBe(false);
  });
  it('IN-04 cooldown: a rule that re-triggers inside its cooldown is recorded, not re-sent', async () => {
    const a = await rule();
    await inc.setDelivery(ctx(), a, { channels: ['in_app', 'sms'], recipientUserIds: [OWNER], cooldownMinutes: 120 });
    await bc.alertEvaluate(ctx(), a);
    expect(sent).toHaveLength(1);
    await alertsSvc.update(ctx() as any, a, { threshold: 999999 } as any); await bc.alertEvaluate(ctx(), a);           // recovered
    await alertsSvc.update(ctx() as any, a, { threshold: 100 } as any);
    const r: any = await bc.alertEvaluate(ctx(), a);                                                                    // triggered again, 0 min later
    expect(r.stateChange).toBe('triggered');
    expect(sent).toHaveLength(1);
    expect(r.deliveries.every((d: any) => d.status === 'skipped' && d.reason === 'cooldown')).toBe(true);
  });
  it('IN-05 settings are validated: a recipient from outside the salon, an unknown channel or hour are refused', async () => {
    const a = await rule();
    expect(await code(inc.setDelivery(ctx(), a, { recipientUserIds: [id(99)] }))).toBe('VALIDATION_FAILED');
    expect(await code(inc.setDelivery(ctx(), a, { channels: ['fax'] }))).toBe('VALIDATION_FAILED');
    expect(await code(inc.setDelivery(ctx(), a, { quietHoursStart: 25 }))).toBe('VALIDATION_FAILED');
    expect(await code(inc.setDelivery(ctx(), a, { severity: 'urgent' }))).toBe('VALIDATION_FAILED');
    const d: any = await inc.delivery(ctx(), a);
    expect(d).toMatchObject({ severity: 'warning', channels: ['in_app'], quietHoursStart: 21, quietHoursEnd: 8, cooldownMinutes: 60 });
    expect(d.staff.map((s: any) => s.name)).toEqual(['Manager Lee', 'Owner Kim']);
  });
});

describe('A2 — incidents', () => {
  it('IC-01 investigate → assign → snooze (wakes up open) → resolve (needs a note) → reopen; every change versioned and logged', async () => {
    const a = await rule();
    const ev: any = await bc.alertEvaluate(ctx(), a);
    let d: any = await inc.detail(ctx(), ev.eventId);
    expect(d).toMatchObject({ incidentStatus: 'open', version: 1 });
    let r: any = await inc.act(ctx(), ev.eventId, { action: 'investigate', expectedVersion: 1, note: 'checking the drawer' });
    expect(r).toMatchObject({ incidentStatus: 'investigating', version: 2 });
    expect(await code(inc.act(ctx(), ev.eventId, { action: 'resolve', expectedVersion: 1, note: 'x' }))).toBe('VERSION_CONFLICT');
    r = await inc.act(ctx(), ev.eventId, { action: 'assign', expectedVersion: 2, assigneeUserId: MGR });
    expect(await code(inc.act(ctx(), ev.eventId, { action: 'assign', expectedVersion: 3, assigneeUserId: id(98) }))).toBe('VALIDATION_FAILED');
    r = await inc.act(ctx(), ev.eventId, { action: 'snooze', expectedVersion: 3, snoozeMinutes: 60 });
    expect(r.incidentStatus).toBe('snoozed');
    clock += 61 * 60_000;
    expect((await inc.sweep()).woke).toBeGreaterThanOrEqual(1);
    d = await inc.detail(ctx(), ev.eventId);
    expect(d.incidentStatus).toBe('open');
    expect(await code(inc.act(ctx(), ev.eventId, { action: 'resolve', expectedVersion: d.version, note: '' }))).toBe('VALIDATION_FAILED');
    r = await inc.act(ctx(), ev.eventId, { action: 'resolve', expectedVersion: d.version, note: 'big walk-in day, not a problem' });
    expect(r.incidentStatus).toBe('resolved');
    await inc.addNote(ctx(), ev.eventId, { note: 'shared with the owner' });
    d = await inc.detail(ctx(), ev.eventId);
    expect(d).toMatchObject({ incidentStatus: 'resolved', resolvedBy: 'Owner Kim', resolutionNote: 'big walk-in day, not a problem', assignee: { name: 'Manager Lee' } });
    expect(d.log.map((l: any) => l.kind)).toEqual(['notify', 'status', 'assign', 'status', 'status', 'status', 'note']);
    expect(d.log[2].body).toBe('Assigned to Manager Lee.');
    r = await inc.act(ctx(), ev.eventId, { action: 'reopen', expectedVersion: d.version });
    expect(r.incidentStatus).toBe('open');
    const l: any = await inc.list(ctx(), { status: 'active' });
    expect(l.items.some((i: any) => i.eventId === ev.eventId)).toBe(true);
  });
  it('IC-02 the old Acknowledge moves an open incident to investigating', async () => {
    const a = await rule();
    const ev: any = await bc.alertEvaluate(ctx(), a);
    await bc.alertAcknowledge(ctx(), ev.eventId, { note: 'seen' });
    expect((await inc.detail(ctx(), ev.eventId)).incidentStatus).toBe('investigating');
  });
  it('IC-03 escalation: a CRITICAL incident still open after 30 minutes goes once more to the owners; a warning one does not', async () => {
    const crit = await rule(), warn = await rule();
    await inc.setDelivery(ctx(), crit, { severity: 'critical', channels: ['in_app'] });
    const e1: any = await bc.alertEvaluate(ctx(), crit), e2: any = await bc.alertEvaluate(ctx(), warn);
    await q(`update ai_business_alert_events set evaluated_at = $2 where id = any($1::uuid[])`, [[e1.eventId, e2.eventId], new Date(clock)]);
    clock += 31 * 60_000;
    const s = await inc.sweep();
    expect(s.escalated).toBe(1);
    const d: any = await inc.detail(ctx(), e1.eventId);
    expect(d.escalatedAt).not.toBeNull();
    expect(d.deliveries.filter((x: any) => x.kind === 'escalation').map((x: any) => x.channel)).toEqual(['in_app']);
    expect((await inc.detail(ctx(), e2.eventId)).escalatedAt).toBeNull();
    expect((await inc.sweep()).escalated).toBe(0);                                          // once
    expect(alertMessage({ title: 'X', metric_id: 'no_show_rate', operator: 'gt', threshold: 10, value: 12.5, severity: 'critical', escalation: true }).body).toMatch(/^Still open after 30 minutes — X: No-show rate is 12\.5% \(above 10%\)/);
  });
  it('IC-04 a branch login sees only its branch; another salon cannot read an incident', async () => {
    const a = await rule();
    const ev: any = await bc.alertEvaluate(ctx(), a);
    expect(await code(inc.detail(ctx({ tenantId: id(77) }), ev.eventId))).toBe('BC_EVENT_NOT_FOUND');
    expect(await code(inc.detail(ctx({ branchId: id(78) }), ev.eventId))).toBe('BC_EVENT_NOT_FOUND');
    expect(await code(inc.detail(ctx({ permissions: [] }), ev.eventId))).toBe('PERMISSION_DENIED');
  });
});

// extras AI Business Alerts 08 — budget-aware SMS: the delivery settings carry what one trigger would text and cost, the
// sender and limits on file, and the loop guards; read-only (nothing is written by reading it).
describe('A2 — SMS plan (budget-aware SMS protection)', () => {
  it('SP-01 recipients and segments from the send path\'s own selection; cost from the salon\'s own provider costs (none → null); sender, limits, loop guards', async () => {
    const { estimateSmsSegments } = await import('@aipowersalon/api-contracts');
    const a = await rule({ title: 'Budget watch' });
    const deliveriesBefore = (await q(`select count(*)::int as n from ai_business_alert_deliveries where tenant_id = $1`, [T]))[0].n;
    let d: any = await inc.delivery(ctx(), a);
    const seg = estimateSmsSegments(alertMessage({ title: 'Budget watch', metric_id: 'net_sales', operator: 'gt', threshold: 100, value: 100, severity: 'warning' }).body).segments;
    expect(seg).toBeGreaterThan(0);
    // default recipients: the active owners and managers — Owner Kim has a phone, Manager Lee does not; Tech Ann is not one
    expect(d.smsPlan).toMatchObject({ recipients: 2, recipientsWithPhone: 1, recipientsWithoutPhone: 1, segmentsPerMessage: seg, segmentsPerTrigger: seg,
      perSegmentMicros: null, estimatedCostCentsPerTrigger: null, senderConfigured: false, limits: null, costBasis: 'salon_provider_average_30d' });
    expect(d.smsPlan.loopGuards).toMatchObject({ cooldownMinutes: 60, escalateOnceAfterMinutes: 30, quietHours: true, sentByRuleLast24h: 0 });
    expect(d.smsPlan.warnings).toEqual(['sender_not_configured']);
    // the salon's own texts in the last 30 days: 3 segments for 23,700 micros → 7,900 per segment; an unreported cost, a
    // 40-day-old text and another salon's text never count
    await q(`insert into notifications (tenant_id, channel, to_address, body, status, created_at, segment_count, provider_cost_micros) values
      ($1,'sms','+16095550001','a','delivered', now() - interval '2 days', 2, 15800), ($1,'sms','+16095550001','b','delivered', now() - interval '1 day', 1, 7900),
      ($1,'sms','+16095550001','c','delivered', now() - interval '1 day', 1, null), ($1,'sms','+16095550001','d','delivered', now() - interval '40 days', 1, 90000),
      ($2,'sms','+16095550009','x','delivered', now() - interval '1 day', 1, 99999)`, [T, id(77)]);
    await q(`insert into tenant_messaging_credentials (tenant_id, status, from_number, last_validated_at, created_at, updated_at) values ($1,'configured','+16095550100', now() - interval '1 hour', now(), now())`, [T]);
    await q(`insert into tenant_messaging_limits (tenant_id, daily_limit, monthly_sms, enforcement) values ($1, 50, 1000, 'hard')`, [T]);
    // texting Owner Kim and Tech Ann with no cooldown — two phones, and the plan says nothing stops a re-trigger
    await inc.setDelivery(ctx(), a, { channels: ['in_app', 'sms'], recipientUserIds: [OWNER, TECH], cooldownMinutes: 0 });
    d = await inc.delivery(ctx(), a);
    expect(d.smsPlan).toMatchObject({ recipients: 2, recipientsWithPhone: 2, recipientsWithoutPhone: 0, segmentsPerTrigger: 2 * seg, perSegmentMicros: 7900,
      estimatedCostCentsPerTrigger: Math.ceil((2 * seg * 7900) / 10_000), senderConfigured: true, limits: { dailyLimit: 50, monthlySms: 1000, enforcement: 'hard', active: true } });
    expect(d.smsPlan.senderValidatedAt).toMatch(/^\d{4}-/);
    expect(d.smsPlan.warnings).toEqual(['no_cooldown']);
    expect((await q(`select count(*)::int as n from ai_business_alert_deliveries where tenant_id = $1`, [T]))[0].n).toBe(deliveriesBefore + 0);
    // a trigger texts both; the plan then counts this rule's sent SMS over the last 24 hours
    await bc.alertEvaluate(ctx(), a);
    d = await inc.delivery(ctx(), a);
    expect(d.smsPlan.loopGuards.sentByRuleLast24h).toBe(2);
    expect(d.smsPlan.loopGuards.alertSmsSentLast24h).toBeGreaterThanOrEqual(2);
  });
});

describe('extras AI BUSINESS ALERTS 05 — per-person unread, separate from the incident lifecycle', () => {
  const ALERTS = [...PERMS, 'owner.alerts.view'];
  beforeAll(async () => {
    // migration 873 is applied again here when present (idempotent) — a branch run before the shared schema cache holds it
    const f873 = join(MIGRATIONS_DIR, '873_staff_alert_reads.sql');
    if (existsSync(f873)) await applyMigrationToPglite(pg, readFileSync(f873, 'utf8'));
  });
  const row = async (c: any, eventId: string) => (await inc.list(c, { status: 'all', limit: 100 })).items.find((i: any) => i.eventId === eventId);
  it('RS-01 each person has their own unread; reading (staff_alert_reads) never moves the incident, and acknowledging never marks it read', async () => {
    const a = await rule({ title: 'Read state watch' });
    const ev: any = await bc.alertEvaluate(ctx(), a);
    const oa = await q(`select id from owner_alerts where tenant_id = $1 and metadata->>'eventId' = $2`, [T, ev.eventId]);
    expect(oa).toHaveLength(1);
    expect((await row(ctx({ permissions: ALERTS }), ev.eventId)).readState).toEqual({ unread: true, unreadAlertIds: [oa[0].id] });
    expect((await row(ctx({ userId: MGR, role: 'MANAGER', permissions: ALERTS }), ev.eventId)).readState).toEqual({ unread: true, unreadAlertIds: [oa[0].id] });
    // the owner reads it (the row POST /tenant/notifications/alerts/read writes)
    await q(`insert into staff_alert_reads (tenant_id, user_id, alert_id) values ($1, $2, $3)`, [T, OWNER, oa[0].id]);
    expect((await row(ctx({ permissions: ALERTS }), ev.eventId)).readState).toEqual({ unread: false, unreadAlertIds: [] });
    expect((await row(ctx({ userId: MGR, role: 'MANAGER', permissions: ALERTS }), ev.eventId)).readState.unread).toBe(true);
    expect((await inc.detail(ctx(), ev.eventId)).incidentStatus).toBe('open');                 // a read is not an acknowledgement
    // the manager acknowledges the incident: lifecycle moves, nobody's read state does
    await bc.alertAcknowledge(ctx({ userId: MGR, role: 'MANAGER' }), ev.eventId, { note: 'on it' });
    expect((await inc.detail(ctx(), ev.eventId)).incidentStatus).toBe('investigating');
    expect((await row(ctx({ userId: MGR, role: 'MANAGER', permissions: ALERTS }), ev.eventId)).readState.unread).toBe(true);
    // without owner.alerts.view there is no read state to show
    expect((await row(ctx(), ev.eventId)).readState).toBeNull();
  });
});

// extras round 11 — staff notification preferences are ENFORCED here through the ONE rule (api-contracts
// staffNotificationAllowed) and the ONE reader (communications staffSendDecision): a recipient who switched SMS or Email
// off in My Account → Notifications is skipped with reason staff_pref_off (in-app still lands); the SMS plan counts only the
// texts that would go. Own users (id 9610+) so the tests above are unaffected.
describe('A2 — staff notification switches (extras round 11)', () => {
  const OFF = id(9610), ON = id(9611);
  beforeAll(async () => {
    await q(`insert into users (id, tenant_id, full_name, email, normalized_phone, status, role) values
      ($1,$3,'Mgr Off','off@bc.test','+16095559610','active','MANAGER'), ($2,$3,'Mgr On','on@bc.test','+16095559611','active','MANAGER')`, [OFF, ON, T]);
    await q(`insert into user_notification_prefs (tenant_id, user_id, sms_notifications, email_notifications) values ($1,$2,false,true)`, [T, OFF]);
  });
  it('SN-01 SMS switched off → that person\'s text is SKIPPED (staff_pref_off) and never handed to the messenger; their email and the other person\'s text still go', async () => {
    const a = await rule({ title: 'Pref watch' });
    await inc.setDelivery(ctx(), a, { channels: ['in_app', 'email', 'sms'], recipientUserIds: [OFF, ON], cooldownMinutes: 0 });
    const r: any = await bc.alertEvaluate(ctx(), a);
    expect(sent.map((s) => [s.ch, s.to]).sort()).toEqual([['email', 'off@bc.test'], ['email', 'on@bc.test'], ['sms', '+16095559611']]);
    expect(r.deliveries).toEqual(expect.arrayContaining([expect.objectContaining({ channel: 'sms', status: 'skipped', reason: 'staff_pref_off', recipient: '+16095559610' }), expect.objectContaining({ channel: 'in_app', status: 'sent' })]));
    const row = (await q(`select status, reason, recipient_user_id from ai_business_alert_deliveries where event_id = $1 and channel = 'sms' and recipient_user_id = $2`, [r.eventId, OFF]))[0];
    expect(row).toMatchObject({ status: 'skipped', reason: 'staff_pref_off' });
  });
  it('SN-02 Email switched off too → their email is skipped the same way; a person with no saved row gets everything (defaults on)', async () => {
    await q(`update user_notification_prefs set email_notifications = false where tenant_id = $1 and user_id = $2`, [T, OFF]);
    const a = await rule({ title: 'Pref watch 2' });
    await inc.setDelivery(ctx(), a, { channels: ['in_app', 'email', 'sms'], recipientUserIds: [OFF, ON], cooldownMinutes: 0 });
    const r: any = await bc.alertEvaluate(ctx(), a);
    expect(sent.map((s) => s.to).sort()).toEqual(['+16095559611', 'on@bc.test']);
    expect(r.deliveries.filter((d: any) => d.reason === 'staff_pref_off').map((d: any) => d.channel).sort()).toEqual(['email', 'sms']);
  });
  it('SN-03 the SMS plan counts only texts that would go: the switched-off person is reported, not costed', async () => {
    const a = await rule({ title: 'Pref plan' });
    await inc.setDelivery(ctx(), a, { channels: ['in_app', 'sms'], recipientUserIds: [OFF, ON] });
    const d: any = await inc.delivery(ctx(), a);
    expect(d.smsPlan).toMatchObject({ recipients: 2, recipientsWithPhone: 1, recipientsWithoutPhone: 0, recipientsSmsOff: 1, segmentsPerTrigger: d.smsPlan.segmentsPerMessage });
  });
});
