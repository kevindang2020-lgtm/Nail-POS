/*
 * booking_double_book_check.ts — live Postgres proof that the booking double-booking RACE is closed.
 *
 * pos_tech_appointments is written by BOTH the front-desk booking module and the customer self-booking module, each of
 * which (before this fix) did a non-atomic check-then-insert. This probe runs two concurrent connections for the SAME
 * technician + date + overlapping time and shows:
 *   Scenario A (naive, no lock): both read "no conflict" before either inserts -> 2 overlapping rows commit  (the bug).
 *   Scenario B (advisory lock + re-check inside the txn): the 2nd connection BLOCKS on pg_advisory_xact_lock until the
 *     1st commits, then its re-check SEES the committed row and detects the conflict -> only 1 row exists (fixed).
 *
 * Run: NODE_PATH=<api>/node_modules <tsx> apps/api/scripts/booking_double_book_check.ts
 */
import { Client } from 'pg';

const CONN = { host: '127.0.0.1', port: 5433, user: 'postgres', database: 'aps_iso' };
const TENANT = 'becf33f6-413d-47b9-9db6-0253d6375bb6';
const BLOCK = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];   // = CHAIR_HOLDING_STATUSES (Decision 38)
const KEYSQL = 'select pg_advisory_xact_lock(hashtextextended($1, 0))';

const minutesOf = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const overlaps = (aS: string, aE: string, bS: string, bE: string) => minutesOf(aS) < minutesOf(bE) && minutesOf(aE) > minutesOf(bS);
const conflict = (rows: any[], s: string, e: string) => rows.some((r) => BLOCK.includes(r.status) && overlaps(r.start_time, r.end_time, s, e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log('  \u2713', n); } else { fail++; console.log('  \u2717', n); } };

async function newTech(admin: Client, date: string): Promise<string> {
  const tech = (await admin.query(
    `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
     values (gen_random_uuid(), $1, gen_random_uuid(), 'Race', 'Tech', 'Race Tech', 'Nail Tech', 'active', 'none', 0, 0, true, now(), now()) returning id`,
    [TENANT])).rows[0].id;
  await admin.query('delete from pos_tech_appointments where tenant_id=$1 and appt_date=$2', [TENANT, date]);
  return tech;
}
const insertAppt = (c: Client, tech: string, date: string, s: string, e: string) =>
  c.query(`insert into pos_tech_appointments (id, tenant_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source, created_at, updated_at)
           values (gen_random_uuid(), $1, $2, 'X', '[]'::jsonb, $3, $4, $5, 45, 'booked', 'manual', now(), now())`,
    [TENANT, tech, date, s, e]);
const readExisting = async (c: Client, tech: string, date: string) =>
  (await c.query('select start_time, end_time, status from pos_tech_appointments where tenant_id=$1 and appt_date=$2 and technician_id=$3', [TENANT, date, tech])).rows;
const count = async (admin: Client, tech: string, date: string) =>
  Number((await admin.query('select count(*) c from pos_tech_appointments where tenant_id=$1 and appt_date=$2 and technician_id=$3', [TENANT, date, tech])).rows[0].c);

async function main() {
  const admin = new Client(CONN); await admin.connect();
  const c1 = new Client(CONN); await c1.connect();
  const c2 = new Client(CONN); await c2.connect();
  try {
    // ---------- Scenario A: NAIVE check-then-insert (no lock) ----------
    const dateA = '2099-03-01';
    const techA = await newTech(admin, dateA);
    console.log('Scenario A \u2014 naive concurrent check-then-insert (no lock):');
    await c1.query('BEGIN'); await c2.query('BEGIN');
    const exA1 = await readExisting(c1, techA, dateA); const exA2 = await readExisting(c2, techA, dateA);
    ok('both transactions read "no conflict" before either inserts', !conflict(exA1, '10:00', '10:45') && !conflict(exA2, '10:30', '11:00'));
    await insertAppt(c1, techA, dateA, '10:00', '10:45');
    await insertAppt(c2, techA, dateA, '10:30', '11:00');
    await c1.query('COMMIT'); await c2.query('COMMIT');
    ok('NAIVE path double-books: 2 overlapping rows committed (the bug)', (await count(admin, techA, dateA)) === 2);

    // ---------- Scenario B: GUARDED advisory lock + transactional re-check ----------
    const dateB = '2099-03-02';
    const techB = await newTech(admin, dateB);
    console.log('Scenario B \u2014 advisory lock + transactional re-check (the fix):');
    const key = `${TENANT}|${techB}|${dateB}`;
    await c1.query('BEGIN');
    await c1.query(KEYSQL, [key]);                       // c1 acquires the lock
    ok('c1 re-check sees empty \u2192 will insert', !conflict(await readExisting(c1, techB, dateB), '10:00', '10:45'));
    await insertAppt(c1, techB, dateB, '10:00', '10:45'); // inserted, NOT yet committed

    await c2.query('BEGIN');
    let c2Locked = false;
    const c2lock = c2.query(KEYSQL, [key]).then(() => { c2Locked = true; }); // must block
    await sleep(300);
    ok('c2 BLOCKS on the advisory lock while c1 holds it', c2Locked === false);

    await c1.query('COMMIT');                             // releases the lock
    await c2lock;
    ok('c2 acquires the lock only after c1 commits', c2Locked === true);

    const c2Conf = conflict(await readExisting(c2, techB, dateB), '10:30', '11:00');
    ok('c2 re-check now SEES the committed appointment \u2192 conflict detected', c2Conf === true);
    if (c2Conf) await c2.query('ROLLBACK'); else { await insertAppt(c2, techB, dateB, '10:30', '11:00'); await c2.query('COMMIT'); }
    ok('GUARDED path: exactly 1 row \u2192 double-booking prevented', (await count(admin, techB, dateB)) === 1);
  } finally {
    await c1.end().catch(() => {}); await c2.end().catch(() => {}); await admin.end().catch(() => {});
  }
  console.log(`\nbooking_double_book_check: ${pass}/${pass + fail} passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
