// reminder-dispatch.postgres-race — Appointment Reminders guide §8 / §16 Concurrency on REAL Postgres with real
// concurrency (four Kysely instances = four sessions; each run / action is its own transaction as in production):
//   • 8 overlapping reminder runs (scheduler + /jobs route + instances) over 6 due appointments → each reminded ONCE
//   • staff Cancel Pending racing the run's claim, 8 times → per reminder: cancelled and never sent, OR sent and the
//     cancel refused — never both
//   • two staff Safe Retries of the same failed reminder with different keys → one send, the other refused
//   • a reschedule racing the pre-send re-check → the dispatch record and the provider call always agree
// Fresh random salons per run (the CI race database is shared); the provider is a recording fake (no real SMS).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyRemindersRepository } from './reminders.kysely.repository';
import { RemindersService, type NotificationSender } from './reminders.service';
import { ReminderCenter, type RcCtx } from './reminder-center';
import { occurrenceKey } from './reminder-core';

const url = process.env.PG_RACE_URL;
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID();
const TAG = `rmr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const TZ = 'America/New_York';
const H = 3_600_000, M = 60_000;
const ctx: RcCtx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', allowedBranches: null };

describe.skipIf(!url)('appointment reminders on real Postgres: one reminder per occurrence under concurrency', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const sends: string[] = [];
  let failNext = 0;
  const sender = (db: Kysely<any>): NotificationSender => ({
    async send(c, req) {
      if (failNext > 0) { failNext--; return { sent: false, status: 'failed', reason: 'invalid_destination' }; }
      await new Promise((r) => setTimeout(r, 15));   // a provider call takes time: widens the race
      const r = await sql<{ id: string }>`insert into notifications (tenant_id, channel, to_address, body, status, purpose, source_type, source_id) values (${c.tenantId}, ${req.channel}, ${req.to}, ${req.body}, 'sent', 'reminder', 'appointment', ${req.source?.id ?? null}) returning id`.execute(db);
      sends.push(req.source?.id ?? '?');
      return { sent: true, status: 'sent', id: r.rows[0].id };
    },
  });
  const svcs = dbs.map((d) => new RemindersService(new KyselyRemindersRepository(d), sender(d)));
  const centers = dbs.map((d, i) => new ReminderCenter(d, svcs[i]));
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const local = (ms: number) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const g = (t: string) => f.find((x) => x.type === t)!.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
  };
  async function appt(startMs: number) {
    const a = randomUUID(), tech = randomUUID(), cust = randomUUID(); const l = local(startMs);
    const [hh, mm] = l.time.split(':').map(Number); const e = Math.min(hh * 60 + mm + 45, 23 * 60 + 59);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${tech}, ${T}, ${B}, 'Race', 'Tech', 'Race Tech')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${cust}, ${T}, ${B}, 'Race', 'Cust', 'Race Cust', ${'+1609' + String(Math.floor(1e6 + Math.random() * 8.9e6))}, 'active')`);
    await q(sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services, created_at)
      values (${a}, ${T}, ${B}, ${tech}, ${cust}, 'Race Cust', ${l.date}::date, ${l.time}, ${`${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`}, 'booked', '[]'::jsonb, now() - interval '3 days')`);
    return a;
  }
  const states = async (a: string) => (await q(sql`select state from appointment_reminders_sent where appointment_id = ${a} order by created_at`)).map((r: any) => r.state);

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', ${TZ})`);
    await q(sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'business-branch', ${JSON.stringify({ timezone: TZ })}::jsonb)`);
    await q(sql`insert into reminder_settings (tenant_id, enabled, lead_minutes, window_minutes, channel) values (${T}, true, 1440, 60, 'sms')`);
    await q(sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, from_number, status, last_validated_at) values (${T}, 'twilio', 'AC_RACE', '+16095550100', 'configured', now())`);
  }, 120_000);
  afterAll(async () => {
    // the salon's reminder switch goes off so a later run against this shared database never picks it up
    if (dbs[0]) await q(sql`update reminder_settings set enabled = false where tenant_id = ${T}`);
    await Promise.all(dbs.map((d) => d.destroy()));
  });

  it('8 overlapping runs over 4 sessions, 6 due appointments → every appointment reminded exactly once', async () => {
    const ids = [] as string[]; for (let i = 0; i < 6; i++) ids.push(await appt(Date.now() + 24 * H + (10 + i * 5) * M));
    await Promise.all(Array.from({ length: 8 }, (_, k) => svcs[k % 4].runDueReminders(Date.now(), k % 2 ? 'jobs_route' : 'scheduler')));
    for (const a of ids) {
      expect(sends.filter((s) => s === a)).toHaveLength(1);
      expect(await states(a)).toEqual(['submitted']);
    }
    const runs = await q(sql`select count(*)::int as c, count(*) filter (where outcome = 'ok')::int as ok from appointment_reminder_runs where tenant_id = ${T}`);
    expect(runs[0]).toEqual({ c: 8, ok: 8 });
  });

  it('staff Cancel Pending racing the run\'s claim (8 reminders): cancelled-and-unsent OR sent-and-cancel-refused, never both', async () => {
    for (let i = 0; i < 8; i++) {
      const a = await appt(Date.now() + 24 * H + 12 * M + i * M);
      const [c, r] = await Promise.allSettled([centers[i % 4].cancelPending(ctx, `u:${a}:1440`, 'customer asked to stop'), svcs[(i + 1) % 4].runDueReminders(Date.now(), 'scheduler')]);
      expect(r.status).toBe('fulfilled');
      const st = await states(a); const n = sends.filter((s) => s === a).length;
      if (c.status === 'fulfilled') { expect(st).toEqual(['cancelled']); expect(n).toBe(0); }
      else { expect((c.reason as any)?.code).toBe('REMINDER_NOT_CANCELLABLE'); expect(st).toEqual(['submitted']); expect(n).toBe(1); }
    }
  });

  it('two staff Safe Retries of one failed reminder with different keys → one send, the other refused', async () => {
    const a = await appt(Date.now() + 24 * H + 45 * M);
    failNext = 1; await svcs[0].runDueReminders(Date.now(), 'scheduler');
    const d = (await q(sql`select id, state, reason from appointment_reminders_sent where appointment_id = ${a}`))[0];
    expect(d).toMatchObject({ state: 'failed', reason: 'invalid_destination' });
    const out = await Promise.allSettled([1, 2].map((k) => centers[k].retry(ctx, d.id, { idempotencyKey: `${TAG}-retry-${k}`, confirm: true, reason: 'number fixed' })));
    const ok = out.filter((o) => o.status === 'fulfilled' && (o as any).value.state === 'submitted');
    expect(ok).toHaveLength(1);
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => o.reason?.code)).toEqual(['REMINDER_NOT_RETRYABLE']);
    expect(sends.filter((s) => s === a)).toHaveLength(1);
  });

  it('a reschedule racing the pre-send re-check: the record and the provider always agree (10 rounds)', async () => {
    for (let i = 0; i < 10; i++) {
      // the schema refuses end_time <= start_time and an appointment cannot cross midnight: a start (or its +3 h reschedule)
      // at exactly 23:59 local has no valid end, so step one minute past it (the test ran red only between ~23:20 and midnight)
      const raw = Date.now() + 24 * H + 20 * M + i * M;
      const st = local(raw).time === '23:59' || local(raw + 3 * H).time === '23:59' ? raw + M : raw;
      const a = await appt(st); const l = local(st);
      const dp = (svcs[0] as any).data.dispatch;
      const c = await dp.claim({ tenantId: T, appointmentId: a, leadMinutes: 1440, occurrenceKey: occurrenceKey(l.date, l.time), channel: 'sms', branchId: B, customerId: null, intendedSendAtMs: st - 24 * H, apptStartMs: st, tz: TZ, state: 'claimed', reason: null });
      const cand = { appointmentId: a, startsAtMs: st, status: 'booked', address: '+16095550111', apptDate: l.date, startTime: l.time };
      const nl = local(st + 3 * H); const [hh, mm] = nl.time.split(':').map(Number); const e = Math.min(hh * 60 + mm + 45, 23 * 60 + 59);
      const [out] = await Promise.all([
        svcs[1].sendClaimed((svcs[1] as any).data.dispatch, T, c.id, cand as any, 'sms', TAG, 1440, TZ, Date.now(), { kind: 'automatic' }),
        q(sql`update pos_tech_appointments set appt_date = ${nl.date}::date, start_time = ${nl.time}, end_time = ${`${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`} where id = ${a}`),
      ]);
      const stt = await states(a); const n = sends.filter((s) => s === a).length;
      if (out === 'cancelled') { expect(stt).toEqual(['cancelled']); expect(n).toBe(0); }
      else { expect(out).toBe('submitted'); expect(stt).toEqual(['submitted']); expect(n).toBe(1); }
    }
  });
});
