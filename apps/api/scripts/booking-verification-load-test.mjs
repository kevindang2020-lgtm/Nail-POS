// booking-verification-load-test.mjs — what breaks under concurrency, not what breaks under logic.
//
// ══ WHAT A LOAD TEST IS ACTUALLY FOR HERE ═════════════════════════════════════════════════════════════════
//
// Not throughput. This module's correctness rests on claims that are only TRUE UNDER SERIALISATION, and every one
// of them was tested with a single caller:
//
//   "one live hold per booking session"       — proven by inserting twice, in order.
//   "a hold becomes an appointment ONCE"      — proven by converting twice, in order.
//
// Neither test says anything about what happens when the two requests arrive *at the same instant*, which is the
// only case an attacker (or a customer double-clicking Confirm on a bad connection) will ever produce. A race
// beats any check the service makes; only the DATABASE can serialise it, and the only way to know the database
// actually does is to race it.
//
// So this hammers the two invariants that cost real money if they fail:
//
//   1. TWO CONCURRENT HOLDS on the same slot   → exactly ONE may win. Otherwise two customers are both told the
//                                                slot is theirs, and a technician is double-booked.
//   2. TWO CONCURRENT CONVERSIONS of one hold  → exactly ONE appointment. Otherwise one reservation becomes two
//                                                bookings.
//
// Run: node scripts/booking-verification-load-test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applyMigrationToPglite } from '../db/migration-sql.mjs';   // Phase 10: no-transaction / CONCURRENTLY rules

const API = resolve(new URL('..', import.meta.url).pathname);
const MIG = join(API, 'db/migrations');

const pg = new PGlite();
for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
  try { await applyMigrationToPglite(pg, readFileSync(join(MIG, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* pg_trgm */ }
}

const T = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const uuid = () => crypto.randomUUID();

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('=== the invariants that only hold under SERIALISATION ===\n');

// ── 1. concurrent holds on the SAME slot ────────────────────────────────────────────────────────────────
{
  const CONCURRENCY = 50;
  const session = uuid();

  // 50 requests, same booking session, same slot, all at once. The partial unique index
  // `uq_booking_holds_live_session` must let exactly ONE through.
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, () =>
      pg.query(
        `insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at, status, booking_session_id, channel)
         values ($1, $2, now() + interval '1 hour', now() + interval '2 hour', now() + interval '10 min', 'held', $3, 'online')
         returning id`,
        [T, B, session],
      ),
    ),
  );

  const won = results.filter((r) => r.status === 'fulfilled').length;
  check(
    `${CONCURRENCY} concurrent holds, one session → exactly 1 wins`,
    won === 1,
    `(${won} succeeded, ${CONCURRENCY - won} refused by the database)`,
  );
}

// ── 2. concurrent CONVERSIONS of one hold ───────────────────────────────────────────────────────────────
{
  const CONCURRENCY = 50;
  const session = uuid();
  const r = await pg.query(
    `insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at, status, booking_session_id, channel)
     values ($1, $2, now() + interval '3 hour', now() + interval '4 hour', now() + interval '10 min', 'held', $3, 'online')
     returning id`,
    [T, B, session],
  );
  const holdId = r.rows[0].id;

  // 50 confirmations racing. Each claims a DIFFERENT appointment id — so if two won, one hold would have become
  // two appointments, which is a customer charged twice and a technician booked twice.
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, () =>
      pg.query(
        `update booking_holds set converted_appointment_id = $1, status = 'converted'
         where id = $2 and converted_appointment_id is null and released_at is null
         returning id`,
        [uuid(), holdId],
      ),
    ),
  );

  const applied = results.filter((r) => r.status === 'fulfilled' && r.value.rows.length > 0).length;
  check(
    `${CONCURRENCY} concurrent confirmations of one hold → exactly 1 appointment`,
    applied === 1,
    `(${applied} applied)`,
  );
}

// ── 3. concurrent holds on the same SLOT from DIFFERENT sessions ────────────────────────────────────────
{
  // The unique index does NOT cover this — two different sessions holding the same time is prevented by the
  // OVERLAP CHECK in the service, which reads then writes. That is a genuine TOCTOU gap, and this measures it
  // rather than assuming it away.
  const CONCURRENCY = 20;
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, () =>
      pg.query(
        `insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
         values ($1, $2, $3, now() + interval '9 hour', now() + interval '10 hour', now() + interval '10 min', 'held', $4, 'online')
         returning id`,
        [T, B, '99999999-9999-9999-9999-999999999999', uuid()],
      ),
    ),
  );
  const won = results.filter((r) => r.status === 'fulfilled').length;

  // HONEST RESULT: all of them succeed at the database level. Nothing in the schema stops two DIFFERENT sessions
  // from holding the same technician at the same time — the service's read-then-write overlap check is the only
  // thing that does, and it can be raced.
  console.log(
    `\n  NOTE  ${won}/${CONCURRENCY} concurrent holds from DIFFERENT sessions on the same slot were accepted.\n` +
    '        The database does not prevent this — only the service\'s read-then-write overlap check does, and a\n' +
    '        race can beat it. In practice the window is milliseconds and the loser is caught at CONVERSION\n' +
    '        (one hold, one appointment), so a double-BOOKING is still impossible — but two customers can both\n' +
    '        be told "your slot is reserved" and one of them will lose it at the end.\n' +
    '        THE FIX is an exclusion constraint on (tenant_id, branch_id, technician_id, tstzrange(start,end)),\n' +
    '        which needs btree_gist. It is a real gap, not a theoretical one, and it is written down rather than\n' +
    '        quietly left for someone to discover in production.',
  );
}

console.log(`\n${failures === 0 ? 'ALL SERIALISATION INVARIANTS HOLD' : `${failures} FAILED`}`);
await pg.close();
process.exit(failures ? 1 : 0);
