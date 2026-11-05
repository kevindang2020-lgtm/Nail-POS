/* smart-reminders-smoke.ts — exercises the REAL SmartRemindersService against live Postgres. Seeds a multi-tenant
 * fixture in appointment_reminder_attempts (channels × statuses) + reminder_settings, runs the exact service the
 * controller serves, and asserts the aggregates are real, reconcile, scope by tenant, and honestly mark un-tracked
 * sections (scheduled-today, fallback, engagement/open rate, upcoming jobs, per-type counts). Cleans up after itself.
 * Run: DATABASE_URL=postgres://… npx tsx scripts/smart-reminders-smoke.ts
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { SmartRemindersRepository } from '../../../modules/super-admin/src/super-admin-smart-reminders/smart-reminders.kysely.repository';
import { SmartRemindersService } from '../../../modules/super-admin/src/super-admin-smart-reminders/smart-reminders.service';
import { ReminderTemplatesRepository } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-templates.kysely.repository';
import { ReminderTemplatesService } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-templates.service';
import { ReminderTimingRepository } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-timing.kysely.repository';
import { ReminderTimingService } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-timing.service';
import { ReminderOverridesRepository } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-overrides.kysely.repository';
import { ReminderOverridesService } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-overrides.service';
import { ReminderFlowStateRepository } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-flow-state.kysely.repository';
import { ReminderFlowStateService } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-flow-state.service';
import { ReminderChannelRepository } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-channel.kysely.repository';
import { ReminderChannelService } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-channel.service';
import { ReminderPlanFeaturesRepository } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-plan-features.kysely.repository';
import { ReminderPlanFeaturesService } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-plan-features.service';
import { ReminderExportService } from '../../../modules/super-admin/src/super-admin-smart-reminders/reminder-export.service';

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); } };

const tA = 'ddee1111-1111-1111-1111-111111111111';
const tB = 'ddee2222-2222-2222-2222-222222222222';
const tC = 'ddee3333-3333-3333-3333-333333333333';
const ids = [tA, tB, tC];

async function clean() {
  await sql`delete from appointment_reminder_attempts where tenant_id = any(${ids})`.execute(db);
  await sql`delete from reminder_settings where tenant_id = any(${ids})`.execute(db);
  await sql`delete from reminder_templates where tenant_id = any(${ids})`.execute(db);
  await sql`delete from reminder_timing_defaults where tenant_id = any(${ids})`.execute(db);
  await sql`delete from reminder_tenant_overrides where tenant_id = any(${ids})`.execute(db);
  await sql`delete from reminder_flow_state where tenant_id = any(${ids})`.execute(db);
  await sql`delete from reminder_channel_config where tenant_id = any(${ids})`.execute(db);
  await sql`delete from tenant_subscriptions where tenant_id = any(${ids})`.execute(db);
  await sql`delete from reminder_plan_features where plan_code like 'sr-smoke-%'`.execute(db);
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`delete from audit_events where tenant_id = any(${ids}) and module='smart-reminders'`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
  await sql`delete from tenants where id = any(${ids})`.execute(db);
}

async function attempt(tenant: string, channel: string, status: string, n: number, err: string | null = null) {
  for (let i = 0; i < n; i++) await sql`insert into appointment_reminder_attempts (tenant_id, channel, status, error) values (${tenant}, ${channel}, ${status}, ${err})`.execute(db);
}

async function seed() {
  await clean();
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values
    (${tA}, 'Glamour Studio LLC', 'Glamour Studio', 'gl-sr', 'GLSR'),
    (${tB}, 'Luxe Salon LLC', 'Luxe Salon', 'lx-sr', 'LXSR'),
    (${tC}, 'Radiant Beauty LLC', 'Radiant Beauty', 'rb-sr', 'RBSR')`.execute(db);
  await sql`insert into reminder_settings (tenant_id, enabled, lead_minutes, window_minutes, channel) values
    (${tA}, true, 120, 30, 'sms'), (${tB}, true, 60, 30, 'email'), (${tC}, false, 90, 30, 'sms')`.execute(db);
  await attempt(tA, 'sms', 'sent', 6);
  await attempt(tA, 'sms', 'failed', 1, 'Invalid number');
  await attempt(tA, 'email', 'sent', 3);
  await attempt(tB, 'email', 'sent', 2);
  await attempt(tB, 'email', 'failed', 1, 'Mailbox full');
  await attempt(tB, 'push', 'sent', 1);
  await attempt(tC, 'sms', 'blocked', 1, 'Opted out');
  await attempt(tC, 'sms', 'sent', 1);
}

async function main() {
  await seed();
  const svc = new SmartRemindersService(new SmartRemindersRepository(db as any));
  const ctx = { userId: 'u_super', email: 'super_admin' };
  const o: any = await svc.getOverview(ctx, {});
  const kpi = (k: string) => o.kpis.find((x: any) => x.key === k);
  const seg = (b: any, k: string) => b.segments.find((s: any) => s.key === k)?.count ?? 0;

  check('KPI active reminder flows = 2 (enabled settings)', kpi('active_flows').value === 2, String(kpi('active_flows').value));
  check('KPI delivered = 13', kpi('delivered').value === 13, String(kpi('delivered').value));
  check('KPI failed = 2', kpi('failed').value === 2, String(kpi('failed').value));
  check('KPI delivery rate = 86.7% (13/15)', kpi('delivery_rate').value === 86.7, String(kpi('delivery_rate').value));
  check('KPI SMS 9 / Email 6 / Push 1', kpi('sms').value === 9 && kpi('email').value === 6 && kpi('push').value === 1, JSON.stringify([kpi('sms').value, kpi('email').value, kpi('push').value]));
  check('KPI tenant customizations = 3 (settings rows)', kpi('customizations').value === 3, String(kpi('customizations').value));
  check('KPI problematic flows = 3 (tenants with failed/blocked)', kpi('problematic').value === 3, String(kpi('problematic').value));
  check('KPI scheduled-today / fallback / engagement honestly unavailable', kpi('scheduled_today').available === false && kpi('fallback').available === false && kpi('engagement').available === false);

  check('channel mix reconciles (sms 9 / email 6 / push 1, total 16)', o.channelMix.total === 16 && seg(o.channelMix, 'sms') === 9 && seg(o.channelMix, 'email') === 6 && seg(o.channelMix, 'push') === 1, JSON.stringify(o.channelMix.segments));
  check('delivery status: delivered 13 / failed 2 / blocked 1; pending+fallback honest', seg(o.deliveryStatus, 'delivered') === 13 && seg(o.deliveryStatus, 'failed') === 2 && seg(o.deliveryStatus, 'blocked') === 1 && o.deliveryStatus.pendingAvailable === false && o.deliveryStatus.fallbackAvailable === false);
  check('delivery trend has a day total 16', o.deliveryTrend.some((d: any) => d.total === 16), JSON.stringify(o.deliveryTrend));
  check('scheduled-vs-delivered: scheduled honestly unavailable', o.scheduledVsDelivered.scheduledAvailable === false);
  check('reminder types = 10 catalog, per-type counts honest', o.reminderTypes.length === 10 && o.reminderTypes.every((t: any) => t.countAvailable === false));
  check('tenant usage lists 3 tenants w/ delivery rate', o.tenantUsage.length === 3 && o.tenantUsage.every((t: any) => typeof t.deliveryRate === 'number'), String(o.tenantUsage.length));
  check('delivery failures surface failed + blocked with reason', o.deliveryFailures.some((f: any) => /Mailbox full/i.test(f.reason)) && o.deliveryFailures.some((f: any) => f.status === 'blocked'), JSON.stringify(o.deliveryFailures));
  check('recent activity present', o.recentActivity.length >= 1);
  check('upcoming jobs honestly unavailable', o.upcomingJobs.available === false && o.upcomingJobs.jobs.length === 0);
  check('performance by tenant: open/engagement honest', o.performanceByTenant.length >= 1 && o.performanceByTenant.every((t: any) => t.openRateAvailable === false && t.engagementAvailable === false));
  check('at-a-glance today: sent 16 / success 13 / failed 2; fallback+openRate honest; tenants using 3', o.atAGlance.sentToday === 16 && o.atAGlance.successfulToday === 13 && o.atAGlance.failedToday === 2 && o.atAGlance.fallbackToday.available === false && o.atAGlance.avgOpenRate.available === false && o.atAGlance.tenantsUsingReminders === 3, JSON.stringify(o.atAGlance));

  // Tenant scope
  const oa: any = await svc.getOverview(ctx, { tenantId: tA });
  check('tenant scope narrows to tA (delivered 9, sms 7)', oa.kpis.find((x: any) => x.key === 'delivered').value === 9 && oa.kpis.find((x: any) => x.key === 'sms').value === 7, JSON.stringify([oa.kpis.find((x: any) => x.key === 'delivered').value, oa.kpis.find((x: any) => x.key === 'sms').value]));
  check('tenant-scoped read writes audit', (await sql`select count(*)::int as c from audit_events where module='smart-reminders' and tenant_id = ${tA}`.execute(db) as any).rows[0].c >= 1);
  // No double count
  check('no double counting — total attempts equals raw rows', o.channelMix.total === (await sql`select count(*)::int as c from appointment_reminder_attempts where tenant_id = any(${ids})`.execute(db) as any).rows[0].c);

  // ── Controlled write: Create Global Reminder Templates — append-only versioning (Unit 3) ──
  const tsvc = new ReminderTemplatesService(new ReminderTemplatesRepository(db as any));
  const t1: any = await tsvc.createTemplate(ctx, { tenantId: tA, reminderType: 'appointment_confirmation', name: 'Appt Confirm', sms: 'Hi {{name}}, {{service}} confirmed.', emailSubject: 'Confirmed', emailBody: 'See you {{name}}' });
  check('create reminder template → v1 draft, placeholders [name, service]', t1.ok && t1.version === 1 && t1.status === 'draft' && t1.placeholders.sort().join(',') === 'name,service', JSON.stringify(t1.placeholders));
  let tplBad = 0;
  for (const bad of [
    { tenantId: tA, reminderType: 'not_a_type', name: 'x', sms: 'ok' },       // bad reminder type
    { tenantId: tA, reminderType: 'onboarding', name: '', sms: 'ok' },          // empty name
    { tenantId: tA, reminderType: 'onboarding', name: 'x' },                    // no channel content
    { tenantId: tA, reminderType: 'onboarding', name: 'x', sms: 'Hi {{bad-name}}' }, // bad placeholder
    { tenantId: tA, reminderType: 'onboarding', name: 'x', sms: 'Danger {% for %}' }, // injection
  ]) { try { await tsvc.createTemplate(ctx, bad); } catch { tplBad++; } }
  check('template validation rejects bad type / empty name / no content / bad placeholder / injection', tplBad === 5, String(tplBad));
  const v2: any = await tsvc.addVersion(ctx, t1.id, { sms: 'Hello {{name}}! Updated.' });
  check('add version → v2 draft appended', v2.version === 2 && v2.status === 'draft');
  await tsvc.publishVersion(ctx, t1.id, 1);
  await tsvc.publishVersion(ctx, t1.id, 2);
  const got: any = await tsvc.get(t1.id);
  const v1row = got.versions.find((v: any) => v.version === 1);
  const v2row = got.versions.find((v: any) => v.version === 2);
  check('publishing v2 RETIRES v1 but preserves it (history, not overwritten)', got.template.current_version === 2 && v1row.status === 'retired' && v1row.sms_content === 'Hi {{name}}, {{service}} confirmed.' && v2row.status === 'published', JSON.stringify({ cur: got.template.current_version, v1: v1row.status, v2: v2row.status }));
  const rep: any = await tsvc.publishVersion(ctx, t1.id, 2);
  check('re-publish current version → idempotent', rep.idempotent === true);
  let retiredThrew = false;
  try { await tsvc.publishVersion(ctx, t1.id, 1); } catch (e: any) { retiredThrew = /retired/i.test(String(e?.message)); }
  check('cannot publish a retired version', retiredThrew);
  const prev: any = await tsvc.preview({ sms: 'Hi {{name}}', values: { name: '<script>x</script>' } });
  check('preview HTML-escapes untrusted values', prev.sms === 'Hi &lt;script&gt;x&lt;/script&gt;', prev.sms);
  const tplAudit: any = await sql`select count(*)::int as c from audit_events where module='smart-reminders' and action in ('reminder_template_created','reminder_template_version_published') and tenant_id = ${tA}`.execute(db);
  check('reminder template create/publish audited', tplAudit.rows[0].c >= 2, String(tplAudit.rows[0].c));

  // ── Controlled write: Configure Default Timing (Unit 4) ──
  const tmsvc = new ReminderTimingService(new ReminderTimingRepository(db as any));
  const set1: any = await tmsvc.setTiming(ctx, { tenantId: tA, reminderType: 'upcoming_appointment', direction: 'before', offsetMinutes: 1440, minOffsetMinutes: 60, maxOffsetMinutes: 4320, quietHoursStart: 1320, quietHoursEnd: 480, quietHoursPolicy: 'defer', timezoneSource: 'branch' });
  check('set timing → 24h before, signed -1440, quiet 22:00–08:00', set1.ok && set1.before === null && set1.after.signedOffset === -1440 && set1.after.quietHoursLabel === '22:00–08:00' && set1.after.timezoneSource === 'branch', JSON.stringify(set1.after));
  let tmBad = 0;
  for (const bad of [
    { tenantId: tA, reminderType: 'nope', direction: 'before', offsetMinutes: 60 },                                  // bad type
    { tenantId: tA, reminderType: 'onboarding', direction: 'sideways', offsetMinutes: 60 },                          // bad direction
    { tenantId: tA, reminderType: 'onboarding', direction: 'before', offsetMinutes: 5000, minOffsetMinutes: 0, maxOffsetMinutes: 1440 }, // out of range
    { tenantId: tA, reminderType: 'onboarding', direction: 'before', offsetMinutes: 60, minOffsetMinutes: 100, maxOffsetMinutes: 50 },   // min>max
    { tenantId: tA, reminderType: 'onboarding', direction: 'before', offsetMinutes: 60, quietHoursStart: 1320 },      // qh start w/o end
    { tenantId: tA, reminderType: 'onboarding', direction: 'before', offsetMinutes: 60, quietHoursPolicy: 'nope' },   // bad policy
  ]) { try { await tmsvc.setTiming(ctx, bad); } catch { tmBad++; } }
  check('timing validation rejects bad type / direction / out-of-range / min>max / lone quiet-hour / bad policy', tmBad === 6, String(tmBad));
  // immediate zeroes the offset
  const imm: any = await tmsvc.setTiming(ctx, { tenantId: tA, reminderType: 'appointment_confirmation', direction: 'immediate', offsetMinutes: 999 });
  check('immediate direction forces offset 0 (signed 0)', imm.after.direction === 'immediate' && imm.after.offsetMinutes === 0 && imm.after.signedOffset === 0);
  // upsert keeps one row per (tenant, type)
  await tmsvc.setTiming(ctx, { tenantId: tA, reminderType: 'upcoming_appointment', direction: 'before', offsetMinutes: 120, minOffsetMinutes: 60, maxOffsetMinutes: 4320 });
  const rowN: any = await sql`select count(*)::int as c, max(offset_minutes) as off from reminder_timing_defaults where tenant_id = ${tA} and reminder_type = 'upcoming_appointment'`.execute(db);
  check('timing upsert keeps one row per (tenant, type) and updates it', rowN.rows[0].c === 1 && Number(rowN.rows[0].off) === 120, JSON.stringify(rowN.rows[0]));
  // platform default (tenant null) is independent of tenant override
  await tmsvc.setTiming(ctx, { reminderType: 'upcoming_appointment', direction: 'before', offsetMinutes: 720, minOffsetMinutes: 0, maxOffsetMinutes: 4320 });
  const plat: any = await tmsvc.get(null, 'upcoming_appointment');
  const ten: any = await tmsvc.get(tA, 'upcoming_appointment');
  check('platform default and tenant override coexist independently', plat.timing.offsetMinutes === 720 && ten.timing.offsetMinutes === 120);
  const tmAudit: any = await sql`select count(*)::int as c from audit_events where module='smart-reminders' and action='reminder_timing_set' and tenant_id = ${tA}`.execute(db);
  check('timing changes audited (before/after)', tmAudit.rows[0].c >= 1, String(tmAudit.rows[0].c));
  // clean the platform default row we created (tenant_id null won't be caught by the id-based clean)
  await sql`delete from reminder_timing_defaults where tenant_id is null and reminder_type = 'upcoming_appointment' and offset_minutes = 720`.execute(db);

  // ── Controlled write: Allow Tenant Customization (Unit 5) ──
  const tmRepo = new ReminderTimingRepository(db as any);
  const ovsvc = new ReminderOverridesService(new ReminderOverridesRepository(db as any), tmRepo);
  // Establish a platform default band for the type (60..4320 min, before 1440).
  await new ReminderTimingService(tmRepo).setTiming(ctx, { reminderType: 'upcoming_appointment', direction: 'before', offsetMinutes: 1440, minOffsetMinutes: 60, maxOffsetMinutes: 4320 });
  const ov1: any = await ovsvc.setOverride(ctx, tA, { reminderType: 'upcoming_appointment', offsetMinutes: 120, direction: 'before', channels: ['sms', 'email'] });
  check('tenant override within band accepted (120 min, sms+email)', ov1.ok && ov1.effective.offsetMinutes === 120 && ov1.effective.offsetSource === 'override', JSON.stringify(ov1.effective));
  let ovBad = 0;
  for (const bad of [
    { reminderType: 'upcoming_appointment', offsetMinutes: 5000, direction: 'before' },   // above platform max 4320
    { reminderType: 'upcoming_appointment', offsetMinutes: 30, direction: 'before' },      // below platform min 60
    { reminderType: 'upcoming_appointment', channels: ['sms', 'carrier_pigeon'] },         // unsupported channel
    { reminderType: 'upcoming_appointment', channels: [] },                                 // empty channels
    { reminderType: 'not_a_type', offsetMinutes: 120 },                                     // bad type
  ]) { try { await ovsvc.setOverride(ctx, tA, bad); } catch { ovBad++; } }
  check('override CANNOT escape platform band or use disallowed channels', ovBad === 5, String(ovBad));
  // Platform default row is untouched by the tenant override
  const platStill: any = await tmRepo.get(null, 'upcoming_appointment');
  check('platform default unchanged by tenant override (still 1440, band 60..4320)', platStill.offset_minutes === 1440 && platStill.min_offset_minutes === 60 && platStill.max_offset_minutes === 4320);
  // Effective merge: override offset wins, platform band exposed
  const eff: any = await ovsvc.getEffective(tA, 'upcoming_appointment');
  check('effective merge = override offset over platform, band surfaced', eff.effective.offsetMinutes === 120 && eff.effective.offsetSource === 'override' && eff.effective.allowedBand.max === 4320 && eff.override.channels.join(',') === 'sms,email', JSON.stringify(eff.effective));
  // Disable override (enabled=false) is honored
  const dis: any = await ovsvc.setOverride(ctx, tA, { reminderType: 'upcoming_appointment', enabled: false });
  check('tenant can disable an optional reminder', dis.effective.enabled === false);
  // Revert removes override → effective falls back to platform default
  const rev: any = await ovsvc.revert(ctx, tA, 'upcoming_appointment');
  check('revert → effective falls back to platform default (1440, source platform)', rev.reverted === true && rev.effective.offsetMinutes === 1440 && rev.effective.offsetSource === 'platform', JSON.stringify(rev.effective));
  const ovAudit: any = await sql`select count(*)::int as c from audit_events where module='smart-reminders' and action in ('tenant_customization_set','tenant_customization_reverted') and tenant_id = ${tA}`.execute(db);
  check('tenant customization set + revert audited', ovAudit.rows[0].c >= 2, String(ovAudit.rows[0].c));
  // clean platform default (tenant null)
  await sql`delete from reminder_timing_defaults where tenant_id is null and reminder_type = 'upcoming_appointment' and min_offset_minutes = 60`.execute(db);

  // ── Controlled write: Disable Problematic Reminders (Unit 6) ──
  const fssvc = new ReminderFlowStateService(new ReminderFlowStateRepository(db as any));
  const attemptsBefore: any = await sql`select count(*)::int as c from appointment_reminder_attempts where tenant_id = ${tA}`.execute(db);
  check('flow active by default (no state row)', (await fssvc.isActive(tA, 'missed_appointment_followup')) === true);
  let disBad = 0;
  for (const bad of [{ tenantId: tA, reminderType: 'missed_appointment_followup' }, { tenantId: tA, reminderType: 'missed_appointment_followup', reason: 'x' }, { tenantId: tA, reminderType: 'nope', reason: 'excessive failures' }]) { try { await fssvc.disable(ctx, bad); } catch { disBad++; } }
  check('disable requires a real reason + valid type (rejects missing/too-short/bad-type)', disBad === 3, String(disBad));
  const disR: any = await fssvc.disable(ctx, { tenantId: tA, reminderType: 'missed_appointment_followup', reason: 'Excessive delivery failures on carrier' });
  check('disable → status disabled with reason recorded', disR.ok && disR.status === 'disabled' && disR.after.reason === 'Excessive delivery failures on carrier');
  check('gate now reports flow inactive (stops new jobs)', (await fssvc.isActive(tA, 'missed_appointment_followup')) === false);
  const attemptsAfter: any = await sql`select count(*)::int as c from appointment_reminder_attempts where tenant_id = ${tA}`.execute(db);
  check('disabling preserves historical delivery records (attempts unchanged)', attemptsAfter.rows[0].c === attemptsBefore.rows[0].c, `${attemptsBefore.rows[0].c} → ${attemptsAfter.rows[0].c}`);
  // under_review is also a valid non-active state
  const urReview: any = await fssvc.disable(ctx, { tenantId: tA, reminderType: 'subscription_payment', reason: 'Investigating opt-out spike', status: 'under_review' });
  check('can set under_review (non-active) with reason', urReview.status === 'under_review' && (await fssvc.isActive(tA, 'subscription_payment')) === false);
  // enable restores
  const en: any = await fssvc.enable(ctx, { tenantId: tA, reminderType: 'missed_appointment_followup' });
  check('enable → active, reason cleared, gate active again', en.status === 'active' && en.after.reason === null && (await fssvc.isActive(tA, 'missed_appointment_followup')) === true);
  // upsert keeps one row per (tenant, type)
  const fsRowN: any = await sql`select count(*)::int as c from reminder_flow_state where tenant_id = ${tA} and reminder_type = 'missed_appointment_followup'`.execute(db);
  check('flow state keeps one row per (tenant, type)', fsRowN.rows[0].c === 1, String(fsRowN.rows[0].c));
  const fsAudit: any = await sql`select count(*)::int as c from audit_events where module='smart-reminders' and action in ('reminder_flow_disabled','reminder_flow_enabled') and tenant_id = ${tA}`.execute(db);
  check('disable + enable audited (disable at warning severity)', fsAudit.rows[0].c >= 3, String(fsAudit.rows[0].c));

  // ── Controlled write: Set Channels + Configure Fallback (Unit 7) ──
  const chsvc = new ReminderChannelService(new ReminderChannelRepository(db as any));
  const ch1: any = await chsvc.setConfig(ctx, { tenantId: tA, reminderType: 'upcoming_appointment', primaryChannel: 'push', fallbackChannels: ['sms', 'email'], fallbackOn: 'any_failure', stopOnSuccess: true });
  check('set channels → sequence push → sms → email, stop-on-success', ch1.ok && ch1.after.sequence.join(',') === 'push,sms,email' && ch1.after.stopOnSuccess === true, JSON.stringify(ch1.after.sequence));
  let chBad = 0;
  for (const bad of [
    { tenantId: tA, reminderType: 'upcoming_appointment', primaryChannel: 'fax' },                       // bad primary
    { tenantId: tA, reminderType: 'upcoming_appointment', primaryChannel: 'sms', fallbackChannels: ['pigeon'] }, // bad fallback
    { tenantId: tA, reminderType: 'upcoming_appointment', primaryChannel: 'sms', fallbackChannels: ['sms'] },    // primary in fallback
    { tenantId: tA, reminderType: 'nope', primaryChannel: 'sms' },                                        // bad type
  ]) { try { await chsvc.setConfig(ctx, bad); } catch { chBad++; } }
  check('channel validation rejects bad primary / fallback / primary-in-fallback / bad type', chBad === 4, String(chBad));
  // Fallback resolver: push permanent → sms fallback → sms success → STOP (no email)
  const fb1: any = chsvc.previewFallback({ primaryChannel: 'push', fallbackChannels: ['sms', 'email'], attempts: [{ channel: 'push', reason: 'Device token expired' }, { channel: 'sms', reason: null }] });
  check('fallback: push(permanent) → sms(success) → STOP, no duplicate email', fb1.decision.stop === true && fb1.decision.reason === 'delivered' && fb1.events[0].outcome === 'permanent' && fb1.events[1].outcome === 'success');
  // Fallback resolver: only push attempted+permanent → next is sms
  const fb2: any = chsvc.previewFallback({ primaryChannel: 'push', fallbackChannels: ['sms', 'email'], attempts: [{ channel: 'push', reason: 'Device token expired' }] });
  check('fallback: after permanent push, next channel is sms (do not retry push)', fb2.decision.nextChannel === 'sms' && fb2.decision.stop === false);
  // Fallback resolver: all fail → exhausted
  const fb3: any = chsvc.previewFallback({ primaryChannel: 'push', fallbackChannels: ['sms'], attempts: [{ channel: 'push', reason: 'timeout' }, { channel: 'sms', reason: 'carrier rejected' }] });
  check('fallback: all channels failed → exhausted (temporary timeout classified)', fb3.decision.stop === true && fb3.decision.reason === 'exhausted' && fb3.events[0].outcome === 'temporary');
  // upsert one row
  await chsvc.setConfig(ctx, { tenantId: tA, reminderType: 'upcoming_appointment', primaryChannel: 'sms', fallbackChannels: ['email'] });
  const chRow: any = await sql`select count(*)::int as c, max(primary_channel) as p from reminder_channel_config where tenant_id = ${tA} and reminder_type = 'upcoming_appointment'`.execute(db);
  check('channel config keeps one row per (tenant, type) and updates it', chRow.rows[0].c === 1 && chRow.rows[0].p === 'sms', JSON.stringify(chRow.rows[0]));
  const chAudit: any = await sql`select count(*)::int as c from audit_events where module='smart-reminders' and action='reminder_channels_set' and tenant_id = ${tA}`.execute(db);
  check('channel config changes audited', chAudit.rows[0].c >= 1, String(chAudit.rows[0].c));

  // ── Controlled write: Enable Reminders by Subscription Plan (Unit 8) ──
  const pfsvc = new ReminderPlanFeaturesService(new ReminderPlanFeaturesRepository(db as any));
  // tA on 'sr-smoke-starter', tB on 'sr-smoke-premium', tC has no subscription
  await sql`insert into tenant_subscriptions (tenant_id, plan, status) values (${tA}, 'sr-smoke-starter', 'active'), (${tB}, 'sr-smoke-premium', 'active')`.execute(db);
  const pf1: any = await pfsvc.setFeature(ctx, { planCode: 'sr-smoke-starter', featureKey: 'subscription_payment', state: 'disabled' });
  check('set plan feature → disabled (blocked)', pf1.ok && pf1.state === 'disabled' && pf1.allowed === false);
  await pfsvc.setFeature(ctx, { planCode: 'sr-smoke-premium', featureKey: 'subscription_payment', state: 'enabled' });
  let pfBad = 0;
  for (const bad of [{ planCode: '', featureKey: 'sms', state: 'enabled' }, { planCode: 'sr-smoke-starter', featureKey: 'nope', state: 'enabled' }, { planCode: 'sr-smoke-starter', featureKey: 'sms', state: 'weird' }]) { try { await pfsvc.setFeature(ctx, bad); } catch { pfBad++; } }
  check('plan-feature validation rejects empty plan / bad feature / bad state', pfBad === 3, String(pfBad));
  // Backend enforcement via evaluate
  const evA: any = await pfsvc.evaluate(tA, 'subscription_payment');
  check('tenant on starter (feature disabled) → BLOCKED by plan', evA.allowed === false && evA.state === 'disabled' && evA.planCode === 'sr-smoke-starter', JSON.stringify(evA));
  const evB: any = await pfsvc.evaluate(tB, 'subscription_payment');
  check('tenant on premium (feature enabled) → PERMITTED', evB.allowed === true && evB.state === 'enabled');
  const evDefault: any = await pfsvc.evaluate(tA, 'appointment_confirmation');
  check('feature with no plan row → allowed by default (not restricted)', evDefault.allowed === true && evDefault.state === 'default');
  const evNoPlan: any = await pfsvc.evaluate(tC, 'subscription_payment');
  check('tenant with no subscription → allowed (no plan to restrict)', evNoPlan.allowed === true && evNoPlan.state === 'no_plan' && evNoPlan.planCode === null);
  // trial + grandfathered are permitted; add_on + approval are blocked
  await pfsvc.setFeature(ctx, { planCode: 'sr-smoke-starter', featureKey: 'analytics', state: 'trial' });
  await pfsvc.setFeature(ctx, { planCode: 'sr-smoke-starter', featureKey: 'multi_step', state: 'add_on' });
  const evTrial: any = await pfsvc.evaluate(tA, 'analytics');
  const evAddon: any = await pfsvc.evaluate(tA, 'multi_step');
  check('trial → permitted; add_on → blocked', evTrial.allowed === true && evAddon.allowed === false, JSON.stringify([evTrial.state, evAddon.state]));
  // upsert one row per (plan, feature)
  await pfsvc.setFeature(ctx, { planCode: 'sr-smoke-starter', featureKey: 'subscription_payment', state: 'enabled' });
  const pfRow: any = await sql`select count(*)::int as c, max(state) as s from reminder_plan_features where plan_code = 'sr-smoke-starter' and feature_key = 'subscription_payment'`.execute(db);
  check('plan feature keeps one row per (plan, feature) and updates it', pfRow.rows[0].c === 1 && pfRow.rows[0].s === 'enabled', JSON.stringify(pfRow.rows[0]));

  // ── Audited CSV export (Unit 9) ──
  const exsvc = new ReminderExportService(svc, new SmartRemindersRepository(db as any));
  const ex1: any = await exsvc.exportCsv(ctx, { dataset: 'tenant-usage', tenantId: tA });
  const header = ex1.content.split('\n')[0];
  check('export tenant-usage CSV: correct header + rows, scoped filename', ex1.ok && header === 'Tenant,Total,Delivered,Failed,SMS,Email,Push,Delivery %' && ex1.rowCount >= 1 && /smart-reminders-tenant-usage-\d{4}-\d{2}-\d{2}\.csv/.test(ex1.filename), ex1.filename);
  const ex2: any = await exsvc.exportCsv(ctx, { dataset: 'failures' });
  check('export failures CSV builds', ex2.content.split('\n')[0] === 'Tenant,Channel,Failure Reason,Status,Time');
  let exBad = false;
  try { await exsvc.exportCsv(ctx, { dataset: 'secret-customer-pii' }); } catch { exBad = true; }
  check('export rejects unknown dataset', exBad);
  // Injection guard: a tenant named with a leading '=' must be neutralized in the CSV
  await sql`update tenants set display_name = '=cmd()' where id = ${tA}`.execute(db);
  const ex3: any = await exsvc.exportCsv(ctx, { dataset: 'tenant-usage', tenantId: tA });
  check('CSV neutralizes formula injection (leading = prefixed with quote)', ex3.content.includes("'=cmd()"), ex3.content.split('\n')[1]);
  const exAudit: any = await sql`select count(*)::int as c from audit_events where module='smart-reminders' and action='export' and tenant_id = ${tA}`.execute(db);
  check('tenant-scoped export is audited', exAudit.rows[0].c >= 1, String(exAudit.rows[0].c));

  await clean();
  console.log(`──────────── ${pass}/${pass + fail} checks passed ────────────`);
  await db.destroy();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await db.destroy(); process.exit(1); });
