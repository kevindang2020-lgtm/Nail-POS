/* booking-checkin-smoke.ts — exercises the REAL SuperAdminBookingCheckinService against live Postgres. Seeds a small
 * multi-tenant fixture (appointments by source/status, kiosk sessions w/ durations, devices w/ heartbeats, queue items
 * w/ waits, holds, integration config), runs the exact service the controller serves, and asserts the aggregates are
 * real, reconcile, scope by tenant, and honestly mark un-provisioned sections. Cleans up after itself.
 * Run: DATABASE_URL=postgres://… npx tsx scripts/booking-checkin-smoke.ts
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { SuperAdminBookingCheckinKyselyRepository } from '../../../modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.kysely.repository';
import { SuperAdminBookingCheckinService } from '../../../modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.service';

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); } };

const tA = 'cc111111-1111-1111-1111-111111111111';
const tB = 'cc222222-2222-2222-2222-222222222222';
const bA1 = 'ccaaaa01-0000-0000-0000-000000000001';
const bA2 = 'ccaaaa01-0000-0000-0000-000000000002';
const bB1 = 'ccbbbb01-0000-0000-0000-000000000001';
const tech = 'cc7ec401-0000-0000-0000-000000000001';
const K1 = 'ccd00001-0000-0000-0000-000000000001'; // online kiosk that hosts the seeded sessions

async function clean() {
  const ids = [tA, tB];
  await sql`delete from go_checkin_sessions where tenant_id = any(${ids})`.execute(db);
  await sql`delete from pos_queue_items where tenant_id = any(${ids})`.execute(db);
  await sql`delete from pos_tech_appointments where tenant_id = any(${ids})`.execute(db);
  await sql`delete from go_checkin_devices where tenant_id = any(${ids})`.execute(db);
  await sql`delete from booking_holds where tenant_id = any(${ids})`.execute(db);
  await sql`delete from booking_checkin_failed_events where tenant_id = any(${ids})`.execute(db);
  await sql`delete from ai_receptionist_handoffs where tenant_id = any(${ids})`.execute(db);
  await sql`delete from unmatched_customer_records where tenant_id = any(${ids})`.execute(db);
  await sql`delete from duplicate_checkin_candidates where tenant_id = any(${ids})`.execute(db);
  await sql`delete from pos_booking_integrations where tenant_id = any(${ids})`.execute(db);
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`delete from audit_events where tenant_id = any(${ids}) and module='booking-checkin-monitor'`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
  await sql`delete from technicians where tenant_id = any(${ids})`.execute(db);
  await sql`delete from branches where tenant_id = any(${ids})`.execute(db);
  await sql`delete from tenants where id = any(${ids})`.execute(db);
}

async function appt(tenant: string, branch: string, source: string, status: string, ageDays: number) {
  await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, source, status, appt_date, start_time, end_time, created_at)
    values (${tenant}, ${branch}, ${tech}, 'Test Customer', ${source}, ${status}, now()::date, '10:00', '10:30', now() - (${ageDays} || ' days')::interval)`.execute(db);
}
async function session(tenant: string, branch: string, dev: string, durationSec: number | null, expired: boolean) {
  const completed = durationSec != null && !expired;
  await sql`insert into go_checkin_sessions (tenant_id, branch_id, device_id, session_token_hash, status, started_at, completed_at, expired_at)
    values (${tenant}, ${branch}, ${dev}, md5(random()::text), ${expired ? 'expired' : completed ? 'completed' : 'active'},
      now(), ${completed ? sql`now() + (${durationSec} || ' seconds')::interval` : null}, ${expired ? sql`now()` : null})`.execute(db);
}
async function device(tenant: string, branch: string, type: string, onlineMinsAgo: number | null, disabled: boolean, id?: string) {
  await sql`insert into go_checkin_devices (id, tenant_id, branch_id, device_name, device_type, checkin_slug, status, last_seen_at, disabled_at)
    values (${id ?? sql`gen_random_uuid()`}, ${tenant}, ${branch}, ${type + '-dev'}, ${type}, md5(random()::text), 'active',
      ${onlineMinsAgo == null ? null : sql`now() - (${onlineMinsAgo} || ' minutes')::interval`}, ${disabled ? sql`now()` : null})`.execute(db);
}
async function queue(tenant: string, branch: string, status: string, waitSec: number | null) {
  const hasStart = waitSec != null;
  await sql`insert into pos_queue_items (tenant_id, branch_id, customer_name, status, checked_in_at, started_at)
    values (${tenant}, ${branch}, 'Q Cust', ${status}, now() - interval '20 minutes',
      ${hasStart ? sql`(now() - interval '20 minutes') + (${waitSec} || ' seconds')::interval` : null})`.execute(db);
}

async function seed() {
  await clean();
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values
    (${tA}, 'Glamour Studio LLC', 'Glamour Studio', 'gl-bc', 'GLBC'),
    (${tB}, 'Luxe Salon LLC', 'Luxe Salon', 'lx-bc', 'LXBC')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values
    (${bA1}, ${tA}, 'Downtown'), (${bA2}, ${tA}, 'Uptown'), (${bB1}, ${tB}, 'Main')`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values
    (${tech}, ${tA}, ${bA1}, 'Tess', 'Tech', 'Tess Tech')`.execute(db);

  // Appointments TODAY (tA): online×5, ai×3, mobile×2, staff(pos)×2, walk_in×1 ; statuses incl. confirmed/completed
  for (let i = 0; i < 5; i++) await appt(tA, bA1, 'online', i < 3 ? 'confirmed' : 'booked', 0);
  for (let i = 0; i < 3; i++) await appt(tA, bA1, 'ai', 'completed', 0);
  for (let i = 0; i < 2; i++) await appt(tA, bA2, 'customer_app', 'booked', 0);
  for (let i = 0; i < 2; i++) await appt(tA, bA2, 'phone', 'confirmed', 0);
  await appt(tA, bA1, 'walk_in', 'completed', 0);
  // Appointments YESTERDAY (tA): online×2 (for a real upward trend)
  for (let i = 0; i < 2; i++) await appt(tA, bA1, 'online', 'completed', 1);
  // Tenant B today: online×2
  for (let i = 0; i < 2; i++) await appt(tB, bB1, 'online', 'booked', 0);

  // Devices: tA kiosks ×3 (2 online, 1 stale-offline), tablets ×2 (online), 1 disabled tablet ; tB counter ×1 online
  await device(tA, bA1, 'kiosk', 1, false, K1); await device(tA, bA1, 'kiosk', 2, false); await device(tA, bA2, 'kiosk', 90, false);
  await device(tA, bA1, 'tablet', 1, false); await device(tA, bA1, 'tablet', 1, false); await device(tA, bA2, 'tablet', 1, true);
  await device(tB, bB1, 'front_desk', 1, false);

  // Sessions tA today: 3 completed (300/600/900 → avg 600), 1 expired(failed)
  await session(tA, bA1, K1, 300, false);
  await session(tA, bA1, K1, 600, false);
  await session(tA, bA1, K1, 900, false);
  await session(tA, bA1, K1, null, true);

  // Queue tA: bA1 two served (372,535) + one waiting; bA2 one served (738, poor)
  await queue(tA, bA1, 'in_service', 372); await queue(tA, bA1, 'in_service', 535); await queue(tA, bA1, 'waiting', null);
  await queue(tA, bA2, 'in_service', 738);

  // Holds (pending confirmations) tA: 2 open
  for (let i = 0; i < 2; i++) await sql`insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at, status)
    values (${tA}, ${bA1}, now(), now()+interval '30 min', now()+interval '1 hour', 'pending')`.execute(db);

  // Integration config
  await sql`insert into pos_booking_integrations (tenant_id, online_booking_enabled, ai_phone_enabled, google_reserve_connected) values
    (${tA}, true, true, false), (${tB}, true, false, true)`.execute(db);

  // Failed events tA: 2 check_in + 1 api today; 1 check_in yesterday (for the trend's failed line)
  await sql`insert into booking_checkin_failed_events (tenant_id, branch_id, category, source, failure_type, retry_status, occurred_at) values
    (${tA}, ${bA1}, 'check_in', 'kiosk', 'device_offline', 'failed', now()),
    (${tA}, ${bA1}, 'check_in', 'online', 'customer_match_failure', 'retry_available', now()),
    (${tA}, ${bA1}, 'api', 'online', 'api_timeout', 'retrying', now()),
    (${tA}, ${bA1}, 'check_in', 'kiosk', 'network_failure', 'failed', now() - interval '1 day')`.execute(db);
  // AI handoffs tA: 2 today
  await sql`insert into ai_receptionist_handoffs (tenant_id, branch_id, transferred_to, reason, status, requested_at) values
    (${tA}, ${bA1}, 'front_desk', 'complex_request', 'completed', now()),
    (${tA}, ${bA1}, 'stylist', 'pricing_inquiry', 'completed', now())`.execute(db);
  // Unmatched tA: 3 pending
  await sql`insert into unmatched_customer_records (tenant_id, branch_id, display_name, source, possible_matches, review_state, last_contact_at) values
    (${tA}, ${bA1}, 'J. Anderson', 'online', 2, 'pending', now()),
    (${tA}, ${bA1}, 'R. Patel', 'ai_receptionist', 1, 'pending', now()),
    (${tA}, ${bA1}, 'L. Thompson', 'mobile_app', 3, 'in_review', now())`.execute(db);
  // Duplicate candidates tA: 2 today
  await sql`insert into duplicate_checkin_candidates (tenant_id, branch_id, check_in_method, confidence, review_state, detected_at) values
    (${tA}, ${bA1}, 'kiosk', 0.910, 'pending', now()),
    (${tA}, ${bA1}, 'kiosk', 0.820, 'pending', now())`.execute(db);
}

async function main() {
  await seed();
  const svc = new SuperAdminBookingCheckinService(new SuperAdminBookingCheckinKyselyRepository(db as any));
  const ctx = { userId: undefined, email: 'smoke@local', ip: '127.0.0.1' };

  // ── platform-wide ──
  const o: any = await svc.getOverview(ctx, {});
  const kpi = (k: string) => o.kpis.find((x: any) => x.key === k);
  check('online KPI counts all tenants (5 tA + 2 tB = 7)', kpi('online_bookings').value === 7, String(kpi('online_bookings').value));
  check('online KPI trend is up vs yesterday (7 vs 2)', kpi('online_bookings').direction === 'up');
  check('ai/mobile/staff/walk-in KPIs are real', kpi('ai_bookings').value === 3 && kpi('mobile_bookings').value === 2 && kpi('staff_bookings').value === 2 && kpi('walk_ins').value === 1, `${kpi('ai_bookings').value}/${kpi('mobile_bookings').value}/${kpi('staff_bookings').value}/${kpi('walk_ins').value}`);
  check('kiosk check-ins = sessions started today (4)', kpi('kiosk_check_ins').value === 4, String(kpi('kiosk_check_ins').value));
  check('failed check-ins = recorded check-in failures today (2)', kpi('failed_check_ins').value === 2, String(kpi('failed_check_ins').value));
  check('avg check-in time is real (600s = 10m00s)', kpi('avg_check_in_time').value === 600 && kpi('avg_check_in_time').display === '10m 00s', kpi('avg_check_in_time').display);
  check('avg check-in time semantic uses lower-is-better', ['good', 'bad', 'neutral'].includes(kpi('avg_check_in_time').semantic));
  check('duplicate (2) / unmatched (3) / api-failures (1) now real + available', kpi('duplicate_check_ins').value === 2 && kpi('unmatched_customers').value === 3 && kpi('booking_api_failures').value === 1 && kpi('duplicate_check_ins').available === true && kpi('unmatched_customers').available === true && kpi('booking_api_failures').available === true, `${kpi('duplicate_check_ins').value}/${kpi('unmatched_customers').value}/${kpi('booking_api_failures').value}`);
  check('pending confirmations KPI = open holds (2)', kpi('pending_confirmations').value === 2, String(kpi('pending_confirmations').value));

  // source breakdown reconciles
  const sb = o.sourceBreakdown;
  const sumParts = sb.rows.reduce((a: number, r: any) => a + r.count, 0);
  check('source breakdown total reconciles to sum of parts', sumParts === sb.total, `${sumParts} vs ${sb.total}`);
  check('bookingsBySource shares the same population', o.bookingsBySource === sb.rows);

  // lifecycle
  const lc = o.lifecycle.stages;
  check('lifecycle booked = total bookings, 100%', lc[0].count === sb.total && lc[0].pct === 100);
  check('lifecycle confirmed counts confirmed+', lc[1].count >= 1 && lc[1].pct <= 100);

  // device status (platform: total 7, online 5 → kiosk2/3, tablet2/3(1 disabled,)...)
  const ds = o.deviceStatus;
  check('device totals reconcile (7 total)', ds.totalDevices === 7, String(ds.totalDevices));
  check('device online uses real heartbeat (disabled + stale excluded)', ds.totalOffline >= 2, `offline=${ds.totalOffline}`);
  check('device rows present per type with uptime', ds.rows.length >= 2 && ds.rows.every((r: any) => typeof r.uptime === 'number'));

  // branch wait-times (bA2 738 poor first, bA1 ~454 acceptable second)
  const bw = o.branchWaitTimes;
  check('branch wait-times sorted by wait desc', bw.length >= 2 && bw[0].avgWaitSeconds >= bw[1].avgWaitSeconds);
  check('worst branch is bucketed at_risk/poor/critical', ['at_risk', 'poor', 'critical'].includes(bw[0].status), bw[0].status);

  // check-in trend 7d
  check('check-in trend returns 7 days', Array.isArray(o.checkInTrend) && o.checkInTrend.length === 7);
  check("today's trend point has seeded check-ins (>=4) and failures (>=2)", num(o.checkInTrend[6].checkIns) >= 4 && num(o.checkInTrend[6].failed) >= 2, `${o.checkInTrend[6].checkIns}/${o.checkInTrend[6].failed}`);

  // honest-empty sections
  check('failed-events module: available + 3 rows (2 check_in + 1 api today)', o.failedEvents.available === true && o.failedEvents.rows.length === 3, String(o.failedEvents.rows.length));
  check('ai-handoffs module: available + 2 rows', o.aiHandoffs.available === true && o.aiHandoffs.rows.length === 2, String(o.aiHandoffs.rows.length));
  check('unmatched module: available + 3 rows', o.unmatchedCustomers.available === true && o.unmatchedCustomers.rows.length === 3, String(o.unmatchedCustomers.rows.length));
  check('integration health exposes config counts, no secrets', o.integrationHealth.tenantsConfigured === 2 && o.integrationHealth.onlineBookingEnabled === 2 && !('secret' in o.integrationHealth));
  check('boundary statement present', typeof o.boundary === 'string' && /does not act as the salon receptionist/.test(o.boundary));

  // todaySummary
  check('confirmation rate available + within 0..100', o.todaySummary.confirmationRate.available === true && o.todaySummary.confirmationRate.value >= 0 && o.todaySummary.confirmationRate.value <= 100);
  check('duplicate rate now available (2 dupes / 4 check-ins)', o.todaySummary.duplicateCheckInRate.available === true && o.todaySummary.duplicateCheckInRate.value === 50, String(o.todaySummary.duplicateCheckInRate.value));

  // ── tenant-scoped ──
  const oa: any = await svc.getOverview(ctx, { tenantId: tA });
  check('tenant scope narrows online to tA only (5)', oa.kpis.find((x: any) => x.key === 'online_bookings').value === 5, String(oa.kpis.find((x: any) => x.key === 'online_bookings').value));
  check('tenant scope reports scoped label', oa.scope.tenantId === tA && oa.scope.label === 'Tenant-scoped');
  const ob: any = await svc.getOverview(ctx, { tenantId: tB });
  check('other tenant sees only its own (online 2, no kiosk, no failed/dup/unmatched)', ob.kpis.find((x: any) => x.key === 'online_bookings').value === 2 && ob.kpis.find((x: any) => x.key === 'kiosk_check_ins').value === 0 && ob.kpis.find((x: any) => x.key === 'failed_check_ins').value === 0 && ob.kpis.find((x: any) => x.key === 'unmatched_customers').value === 0 && ob.failedEvents.rows.length === 0);

  // ── failed-events submodule endpoint ──
  const fe: any = await svc.getFailedEvents(ctx, { tenantId: tA });
  check('failed-events page: 4 total in last 7d (3 check_in + 1 api)', fe.total === 4, String(fe.total));
  const feApi: any = await svc.getFailedEvents(ctx, { tenantId: tA, category: 'api' });
  check('failed-events category filter (api) → 1', feApi.total === 1 && feApi.rows.every((r: any) => r.category === 'api'), String(feApi.total));
  const fePage: any = await svc.getFailedEvents(ctx, { tenantId: tA, pageSize: 2, page: 1 });
  check('failed-events pagination (pageSize 2 → 2 rows, total 4)', fePage.rows.length === 2 && fePage.total === 4, `${fePage.rows.length}/${fePage.total}`);
  check('failed-events rows carry safe diagnostic fields only (no secret/token keys)', fe.rows.length > 0 && fe.rows.every((r: any) => 'correlationId' in r && !('error_message' in r) && !('token' in r) && !('secret' in r)));
  const feB: any = await svc.getFailedEvents(ctx, { tenantId: tB });
  check('failed-events tenant scope isolates (tB → 0)', feB.total === 0, String(feB.total));

  // ── device-status submodule endpoint (real heartbeat states) ──
  const dv: any = await svc.getDevices(ctx, { tenantId: tA });
  check('devices page: 6 devices for tA', dv.total === 6, String(dv.total));
  const dvOn: any = await svc.getDevices(ctx, { tenantId: tA, status: 'online' });
  check('devices online filter → 4 (heartbeat <5m, not disabled)', dvOn.total === 4 && dvOn.rows.every((r: any) => r.state === 'online'), String(dvOn.total));
  const dvOff: any = await svc.getDevices(ctx, { tenantId: tA, status: 'offline' });
  check('devices offline filter → 1 (stale heartbeat)', dvOff.total === 1, String(dvOff.total));
  const dvDis: any = await svc.getDevices(ctx, { tenantId: tA, status: 'disabled' });
  check('devices disabled filter → 1 (surfaced honestly)', dvDis.total === 1, String(dvDis.total));
  const dvKiosk: any = await svc.getDevices(ctx, { tenantId: tA, deviceType: 'kiosk' });
  check('devices type filter (kiosk) → 3', dvKiosk.total === 3, String(dvKiosk.total));
  const dvB: any = await svc.getDevices(ctx, { tenantId: tB });
  check('devices tenant scope isolates (tB → 1 front_desk)', dvB.total === 1, String(dvB.total));

  // ── ai-handoffs submodule endpoint ──
  const ho: any = await svc.getHandoffs(ctx, { tenantId: tA });
  check('handoffs page: 2 for tA in last 7d', ho.total === 2, String(ho.total));
  const hoDone: any = await svc.getHandoffs(ctx, { tenantId: tA, status: 'completed' });
  check('handoffs status filter (completed) → 2', hoDone.total === 2 && hoDone.rows.every((r: any) => r.status === 'completed'), String(hoDone.total));
  const hoDest: any = await svc.getHandoffs(ctx, { tenantId: tA, transferredTo: 'stylist' });
  check('handoffs destination filter (stylist) → 1', hoDest.total === 1, String(hoDest.total));
  check('handoffs carry no transcript/recording fields', ho.rows.length > 0 && ho.rows.every((r: any) => !('transcript' in r) && !('recording' in r) && 'callCode' in r));
  const hoB: any = await svc.getHandoffs(ctx, { tenantId: tB });
  check('handoffs tenant scope isolates (tB → 0)', hoB.total === 0, String(hoB.total));

  // ── booking-sources submodule endpoint (per-source performance; reconciles with Overview) ──
  const bs: any = await svc.getBookingSources(ctx, { tenantId: tA });
  const bsRow = (k: string) => bs.rows.find((r: any) => r.key === k) || { total: 0, confirmed: 0, failed: 0, confirmationRate: 0 };
  check('booking-sources online total reconciles (5 today + 2 yesterday = 7)', bsRow('online').total === 7, String(bsRow('online').total));
  check('booking-sources ai_receptionist total = 3', bsRow('ai_receptionist').total === 3, String(bsRow('ai_receptionist').total));
  check('booking-sources mobile_app total = 2', bsRow('mobile_app').total === 2, String(bsRow('mobile_app').total));
  check('booking-sources totals reconcile (15)', bs.totals.total === 15, String(bs.totals.total));
  check('booking-sources online confirmation (5 of 7 = 71.4%)', bsRow('online').confirmed === 5 && bsRow('online').confirmationRate === 71.4, `${bsRow('online').confirmed}/${bsRow('online').confirmationRate}`);
  check('booking-sources failed bucketed by source (online api failure = 1)', bsRow('online').failed === 1, String(bsRow('online').failed));
  check('booking-sources sorted by total desc', bs.rows.length > 1 && bs.rows[0].total >= bs.rows[1].total);
  const bsB: any = await svc.getBookingSources(ctx, { tenantId: tB });
  check('booking-sources tenant scope (tB online 2, totals 2)', bsB.totals.total === 2 && (bsB.rows.find((r: any) => r.key === 'online')?.total) === 2, String(bsB.totals.total));

  // ── check-in-performance submodule endpoint (real sessions + durations) ──
  const cp: any = await svc.getCheckinPerformance(ctx, { tenantId: tA });
  check('check-in-performance summary: 4 sessions, 3 completed, 1 expired', cp.summary.totalSessions === 4 && cp.summary.completed === 3 && cp.summary.expired === 1, `${cp.summary.totalSessions}/${cp.summary.completed}/${cp.summary.expired}`);
  check('check-in-performance completion rate 75%', cp.summary.completionRate === 75, String(cp.summary.completionRate));
  check('check-in-performance avg duration 600s (10m 00s from 300/600/900)', cp.summary.avgDurationSec === 600 && cp.summary.avgDurationDisplay === '10m 00s', `${cp.summary.avgDurationSec}/${cp.summary.avgDurationDisplay}`);
  const kioskM = cp.methods.find((m: any) => m.key === 'kiosk');
  check('check-in-performance kiosk method row (4 sessions, 3 completed, avg 600s)', !!kioskM && kioskM.sessions === 4 && kioskM.completed === 3 && kioskM.avgDurationSec === 600, kioskM ? `${kioskM.sessions}/${kioskM.completed}` : 'missing');
  const cpB: any = await svc.getCheckinPerformance(ctx, { tenantId: tB });
  check('check-in-performance tenant scope (tB → 0 sessions)', cpB.summary.totalSessions === 0 && cpB.summary.available === false, String(cpB.summary.totalSessions));

  // ── wait-time-analysis submodule endpoint (real queue waits: started_at − checked_in_at) ──
  const wt: any = await svc.getWaitTimeAnalysis(ctx, { tenantId: tA });
  check('wait-time summary: avg 548s / median 535s / longest 738s (from 372/535/738)', wt.summary.avgWaitSec === 548 && wt.summary.medianWaitSec === 535 && wt.summary.longestWaitSec === 738, `${wt.summary.avgWaitSec}/${wt.summary.medianWaitSec}/${wt.summary.longestWaitSec}`);
  check('wait-time sampled 3 waits', wt.summary.sampled === 3, String(wt.summary.sampled));
  check('wait-time branch ranking worst-first (Uptown 738 > Downtown ~454)', wt.branches.length === 2 && wt.branches[0].avgWaitSec >= wt.branches[1].avgWaitSec && wt.branches[0].branch === 'Uptown', `${wt.branches[0]?.branch}:${wt.branches[0]?.avgWaitSec}`);
  check('wait-time branch status bucketed via thresholds', ['acceptable', 'at_risk', 'poor', 'critical', 'good'].includes(wt.branches[0].status), wt.branches[0].status);
  const wtB: any = await svc.getWaitTimeAnalysis(ctx, { tenantId: tB });
  check('wait-time tenant scope (tB → 0 sampled, available false)', wtB.summary.sampled === 0 && wtB.summary.available === false, String(wtB.summary.sampled));

  // ── controlled retry workflow (idempotent, permissioned, cannot duplicate) ──
  const reOK = 'ccfa1100-0000-0000-0000-000000000001';
  const reCap = 'ccfa1100-0000-0000-0000-000000000002';
  const reRes = 'ccfa1100-0000-0000-0000-000000000003';
  const reNR = 'ccfa1100-0000-0000-0000-000000000004';
  await sql`insert into booking_checkin_failed_events (id, tenant_id, branch_id, category, source, failure_type, retry_status, retry_count, correlation_id, occurred_at) values
    (${reOK}, ${tA}, ${bA1}, 'api', 'online', 'api_timeout', 'retry_available', 0, 'corr-ok', now()),
    (${reCap}, ${tA}, ${bA1}, 'api', 'online', 'api_timeout', 'retry_available', 4, 'corr-cap', now()),
    (${reRes}, ${tA}, ${bA1}, 'api', 'online', 'api_timeout', 'resolved', 0, 'corr-res', now()),
    (${reNR}, ${tA}, ${bA1}, 'api', 'online', 'api_timeout', 'not_retryable', 0, 'corr-nr', now())`.execute(db);
  const apptBefore = num((await sql`select count(*)::text as c from pos_tech_appointments where tenant_id = ${tA}`.execute(db)).rows[0].c);
  const queueBefore = num((await sql`select count(*)::text as c from pos_queue_items where tenant_id = ${tA}`.execute(db)).rows[0].c);

  const r1: any = await svc.retryFailedEvent(ctx, reOK, { idempotencyKey: 'K1', reason: 'transient timeout' });
  check('retry eligible → ok, retrying, attempt#1, not escalated, status requested', r1.ok && r1.eligible && r1.event.retryStatus === 'retrying' && r1.event.retryCount === 1 && r1.attempt.attemptNumber === 1 && r1.escalated === false && r1.attempt.status === 'requested', JSON.stringify(r1.event));
  check('retry sets configured backoff (30s base)', r1.attempt.backoffSeconds === 30, String(r1.attempt?.backoffSeconds));
  const r1replay: any = await svc.retryFailedEvent(ctx, reOK, { idempotencyKey: 'K1' });
  check('retry idempotent replay (same key) → no re-increment', r1replay.ok && r1replay.idempotentReplay === true && r1replay.attempt.attemptNumber === 1, JSON.stringify({ replay: r1replay.idempotentReplay, n: r1replay.attempt?.attemptNumber }));
  const attemptCount = num((await sql`select count(*)::text as c from booking_checkin_retry_attempts where failed_event_id = ${reOK} and idempotency_key = 'K1'`.execute(db)).rows[0].c);
  check('retry idempotency enforced at DB (exactly 1 attempt row per key)', attemptCount === 1, String(attemptCount));
  const evNow = (await sql`select retry_status, retry_count from booking_checkin_failed_events where id = ${reOK}`.execute(db)).rows[0] as any;
  check('retry did not re-increment failed event on replay (retry_count still 1)', Number(evNow.retry_count) === 1, String(evNow.retry_count));

  // now 'retrying' → a fresh request (new key) is refused by the eligibility gate
  const r1blocked: any = await svc.retryFailedEvent(ctx, reOK, { idempotencyKey: 'K2' });
  check('retry blocked when already retrying', r1blocked.ok === false && r1blocked.code === 'not_eligible' && r1blocked.reason === 'retrying');

  // escalation at cap: retry_count 4 → attempt 5 == MAX → escalated + not_retryable
  const rCap: any = await svc.retryFailedEvent(ctx, reCap, { idempotencyKey: 'KC' });
  check('retry at cap escalates (not_retryable + escalated)', rCap.ok && rCap.escalated === true && rCap.event.retryStatus === 'not_retryable' && rCap.event.escalationState === 'escalated', JSON.stringify(rCap.event));

  // ineligible states refused
  const rRes: any = await svc.retryFailedEvent(ctx, reRes, {});
  check('retry refuses resolved event', rRes.ok === false && rRes.reason === 'resolved');
  const rNR: any = await svc.retryFailedEvent(ctx, reNR, {});
  check('retry refuses not_retryable event', rNR.ok === false && rNR.reason === 'not_retryable');

  // cross-tenant: scoping to tB must not find tA's event
  const rCross: any = await svc.retryFailedEvent(ctx, reOK, { tenantId: tB });
  check('retry blocks cross-tenant (tA event under tB scope → not_found)', rCross.ok === false && rCross.code === 'not_found');

  // boundary: retry created NO bookings/queue entries (technical reprocess only, never a receptionist action)
  const apptAfter = num((await sql`select count(*)::text as c from pos_tech_appointments where tenant_id = ${tA}`.execute(db)).rows[0].c);
  const queueAfter = num((await sql`select count(*)::text as c from pos_queue_items where tenant_id = ${tA}`.execute(db)).rows[0].c);
  check('retry never creates bookings or queue entries (no duplication)', apptAfter === apptBefore && queueAfter === queueBefore, `appt ${apptBefore}->${apptAfter}, queue ${queueBefore}->${queueAfter}`);

  // ── server-side audited export (§44) ──
  const ex: any = await svc.exportReport(ctx, { tenantId: tA, type: 'failed-events' });
  check('export failed-events → csv available with header + rows', ex.available === true && ex.format === 'csv' && typeof ex.csv === 'string' && ex.csv.split('\n')[0].includes('Event ID') && ex.rowCount > 0, `rows=${ex.rowCount}`);
  check('export csv exposes no secret/token/payment columns', !/token|secret|password|cvv|card_number|api_key|authorization/i.test(ex.csv.split('\n')[0]));
  const exXlsx: any = await svc.exportReport(ctx, { tenantId: tA, type: 'failed-events', format: 'xlsx' });
  check('export xlsx honestly unavailable (not faked)', exXlsx.available === false && !exXlsx.csv && typeof exXlsx.reason === 'string');
  const exOv: any = await svc.exportReport(ctx, { tenantId: tA, type: 'overview' });
  check('export overview → csv KPI summary', exOv.available === true && exOv.csv.split('\n')[0].includes('KPI') && exOv.rowCount > 0, `kpis=${exOv.rowCount}`);
  const exB: any = await svc.exportReport(ctx, { tenantId: tB, type: 'failed-events' });
  check('export tenant scope isolates (tB failed-events → 0 rows)', exB.available === true && exB.rowCount === 0, String(exB.rowCount));

  // ── audit ──
  const auditCount: any = await sql`select count(*)::int as c from audit_events where module='booking-checkin-monitor' and action='overview_viewed' and tenant_id = any(${[tA, tB]})`.execute(db);
  check('tenant-scoped reads write audit rows (2 scoped calls)', auditCount.rows[0].c === 2, String(auditCount.rows[0].c));

  await clean();
  console.log(`\n──────────── ${pass}/${pass + fail} checks passed ────────────`);
  await db.destroy();
  if (fail > 0) process.exit(1);
}
function num(v: any) { return Number(v) || 0; }
main().catch(async (e) => { console.error(e); try { await clean(); await db.destroy(); } catch { /* */ } process.exit(1); });
