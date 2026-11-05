/* booking-checkin-recorder-smoke.ts — proves the WRITER seam end-to-end: calling BookingCheckinRecorder lands rows in
 * the event stores that the monitor then surfaces. Uses an isolated marker tenant; cleans up after itself.
 * Run: DATABASE_URL=postgres://… npx tsx scripts/booking-checkin-recorder-smoke.ts
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { BookingCheckinRecorder } from '../../../modules/reports/src/booking-checkin-events/booking-checkin-recorder';
import { SuperAdminBookingCheckinKyselyRepository } from '../../../modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.kysely.repository';
import { SuperAdminBookingCheckinService } from '../../../modules/super-admin/src/super-admin-booking-checkin/super-admin-booking-checkin.service';

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
let pass = 0, fail = 0;
const check = (n: string, c: boolean, extra = '') => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (extra ? '  → ' + extra : '')); } };
const tR = 'ccfec001-0000-0000-0000-000000000001';

async function clean() {
  for (const t of ['booking_checkin_failed_events', 'ai_receptionist_handoffs', 'unmatched_customer_records', 'duplicate_checkin_candidates'])
    await sql`delete from ${sql.ref(t)} where tenant_id = ${tR}`.execute(db);
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`delete from audit_events where tenant_id = ${tR} and module='booking-checkin-monitor'`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
}

async function main() {
  await clean();
  const rec = new BookingCheckinRecorder(db as any);
  // Emit one of each (branchId null — no FK needed; the monitor renders '—').
  await rec.recordFailedEvent({ tenantId: tR, category: 'check_in', source: 'kiosk', checkInMethod: 'kiosk', failureType: 'session_timeout', retryStatus: 'not_retryable' });
  await rec.recordFailedEvent({ tenantId: tR, category: 'api', source: 'online', failureType: 'api_timeout', retryStatus: 'retrying' });
  await rec.recordHandoff({ tenantId: tR, transferredTo: 'front_desk', reason: 'complex_request', status: 'completed' });
  await rec.recordUnmatched({ tenantId: tR, displayName: 'Pat Q.', source: 'ai_receptionist', possibleMatches: 2 });
  await rec.recordDuplicateCandidate({ tenantId: tR, checkInMethod: 'kiosk', confidence: 0.9, matchReasons: ['same_phone', 'same_window'] });

  // Rows landed?
  const counts: any = await sql`select
    (select count(*) from booking_checkin_failed_events where tenant_id=${tR}) as failed,
    (select count(*) from ai_receptionist_handoffs where tenant_id=${tR}) as handoff,
    (select count(*) from unmatched_customer_records where tenant_id=${tR}) as unmatched,
    (select count(*) from duplicate_checkin_candidates where tenant_id=${tR}) as dup`.execute(db);
  const r = counts.rows[0];
  check('recorder inserted 2 failed events', Number(r.failed) === 2, String(r.failed));
  check('recorder inserted 1 handoff', Number(r.handoff) === 1, String(r.handoff));
  check('recorder inserted 1 unmatched', Number(r.unmatched) === 1, String(r.unmatched));
  check('recorder inserted 1 duplicate candidate', Number(r.dup) === 1, String(r.dup));

  // Monitor surfaces them (tenant-scoped).
  const svc = new SuperAdminBookingCheckinService(new SuperAdminBookingCheckinKyselyRepository(db as any));
  const o: any = await svc.getOverview({ email: 'rec-smoke' }, { tenantId: tR });
  const kpi = (k: string) => o.kpis.find((x: any) => x.key === k);
  check('monitor failed_check_ins KPI = 1', kpi('failed_check_ins').value === 1, String(kpi('failed_check_ins').value));
  check('monitor booking_api_failures KPI = 1', kpi('booking_api_failures').value === 1, String(kpi('booking_api_failures').value));
  check('monitor unmatched KPI = 1', kpi('unmatched_customers').value === 1, String(kpi('unmatched_customers').value));
  check('monitor duplicate KPI = 1', kpi('duplicate_check_ins').value === 1, String(kpi('duplicate_check_ins').value));
  check('failed-events module shows 2 rows from the recorder', o.failedEvents.rows.length === 2, String(o.failedEvents.rows.length));
  check('ai-handoffs module shows the recorded handoff', o.aiHandoffs.rows.length === 1 && o.aiHandoffs.rows[0].transferredTo === 'front_desk');
  check('unmatched module shows the recorded record', o.unmatchedCustomers.rows.length === 1 && o.unmatchedCustomers.rows[0].name === 'Pat Q.');

  await clean();
  console.log(`\n──────────── ${pass}/${pass + fail} checks passed ────────────`);
  await db.destroy();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); try { await clean(); await db.destroy(); } catch { /* */ } process.exit(1); });
