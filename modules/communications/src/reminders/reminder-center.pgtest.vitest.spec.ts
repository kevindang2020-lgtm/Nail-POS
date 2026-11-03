/**
 * reminder-center.pgtest — Appointment Reminders Complete Build & Repair Guide (Oct 30 2026), on the REAL schema (747).
 * The real RemindersService + KyselyRemindersRepository (claim-before-send dispatch) + ReminderCenter; only the provider
 * is a recording fake (no real SMS / email ever). Pins the owner's three priorities and §16's scenarios:
 *   §4.1 reschedule / cancellation protection · §4.2 delivery health + guarded retry · §4.3 customer reminder history
 *   idempotency across runs, DST-safe due times, opt-out, missing contact, quiet hours (defer / skip), bounded automatic
 *   retry with backoff, interrupted-send recovery, KPIs on written bases, search / tabs / pages, tenant isolation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyRemindersRepository } from './reminders.kysely.repository';
import { RemindersService, type NotificationSender } from './reminders.service';
import { ReminderCenter, type RcCtx } from './reminder-center';
import { occurrenceKey, inQuietHours, localMinuteOfDay } from './reminder-core';

const P = 'e7470000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), TECH = id('e1'), TECH2 = id('e2'), OWNER = id('f1');
const TZ = 'America/New_York';
const ctx: RcCtx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', allowedBranches: null };
const ctx2: RcCtx = { tenantId: T2, branchId: B2, userId: OWNER, role: 'OWNER', allowedBranches: null };
const H = 3_600_000, M = 60_000;

let pg: any, db: any, repo: KyselyRemindersRepository, svc: RemindersService, center: ReminderCenter;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);
const sent: { to: string; body: string; source?: { id: string } }[] = [];
const optedOut = new Set<string>();
let failNext: string | null = null;
const sender: NotificationSender = {
  async send(c, req) {
    if (optedOut.has(req.to)) return { sent: false, status: 'blocked', reason: 'opted_out' };
    if (failNext) { const why = failNext; failNext = null; if (why === 'throw') throw new Error('provider down'); return { sent: false, status: 'failed', reason: why }; }
    const r = await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id, purpose, source_type, source_id) values ($1,$2,$3,$4,'sent',$5,'reminder','appointment',$6) returning id`,
      [c.tenantId, req.channel, req.to, req.body, 'SM' + Math.random().toString(16).slice(2, 12), req.source?.id ?? null]);
    sent.push({ to: req.to, body: req.body, source: req.source });
    return { sent: true, status: 'sent', id: r[0].id };
  },
};

/** salon-local date + HH:MM of an instant */
function local(ms: number) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t: string) => f.find((x) => x.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}
let n = 0;
async function appt(startMs: number, cust: string | null, o: { tenant?: string; branch?: string; tech?: string; phone?: string | null; name?: string; createdAt?: string } = {}) {
  const l = local(startMs); const a = id('d' + (++n));
  const tech = o.tech ?? id('7' + n);   // one technician per appointment: the booking engine forbids overlaps per technician
  if (!o.tech) await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lina','Tran',$4)`, [tech, o.tenant ?? T, o.branch ?? B, `Lina Tran ${n}`]);
  const [hh, mm] = l.time.split(':').map(Number); const endMin = Math.min(hh * 60 + mm + 45, 23 * 60 + 59);
  const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, appt_date, start_time, end_time, status, services, created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,'booked','[{"serviceName":"Gel Manicure"}]'::jsonb, coalesce($11::timestamptz, now() - interval '3 days'))`,
    [a, o.tenant ?? T, o.branch ?? B, tech, cust, o.name ?? 'Walk In', o.phone === undefined ? null : o.phone, l.date, l.time, end, o.createdAt ?? null]);
  return a;
}
const run = (nowMs: number) => svc.runDueReminders(nowMs, 'manual');
const disp = async (a: string) => q(`select id, state, reason, occurrence_key, attempt_count, notification_id from appointment_reminders_sent where appointment_id = $1 order by created_at`, [a]);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.name + ':' + e?.message; } }
const C1 = id('c1'), C2 = id('c2'), C3 = id('c3'), C4 = id('c4'), CX = id('c9');

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  repo = new KyselyRemindersRepository(db); svc = new RemindersService(repo, sender); center = new ReminderCenter(db, svc);
  for (const [t, code_, b, tz] of [[T, 'RMCA', B, TZ], [T2, 'RMCB', B2, 'UTC']] as const) {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'L',$2,$3,$2,'active')`, [t, code_, code_.toLowerCase()]);
    await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main',$3)`, [b, t, tz]);
    await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'business-branch', $2::jsonb)`, [t, JSON.stringify({ timezone: tz })]);
    await q(`insert into reminder_settings (tenant_id, enabled, lead_minutes, window_minutes, channel) values ($1, true, 1440, 60, 'sms')`, [t]);
    await q(`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, from_number, status, last_validated_at) values ($1,'twilio','AC_TEST','+16095550100','configured', now())`, [t]);
  }
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lina','Tran','Lina Tran'), ($4,$5,$6,'Other','Tech','Other Tech')`, [TECH, T, B, TECH2, T2, B2]);
  const cust = [[C1, 'Ava', 'Kim', '+16095550142', 'ava@rm.test'], [C2, 'Ben', 'Lee', null, 'ben@rm.test'], [C3, 'Cara', 'Opt', '+16095550177', null], [C4, 'Dan', 'Moss', '+16095550188', 'dan@rm.test']] as const;
  for (const [c, f, l, ph, em] of cust) await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1,$2,$3,$4,$5,$6,$7,$8,'active')`, [c, T, B, f, l, `${f} ${l}`, ph, em]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Xena','Other','Xena Other','+16095550199','active')`, [CX, T2, B2]);
  optedOut.add('+16095550177');
}, 240_000);

describe('dispatch: claim before send, one reminder per occurrence (guide §7, §8)', () => {
  let A: string; const start = Date.now() + 24 * H + 30 * M;
  it('a due reminder is claimed, sent once and recorded with its provider link, event trail and a run row', async () => {
    A = await appt(start, C1);
    const s = await run(Date.now());
    expect(s.sent).toBeGreaterThanOrEqual(1);
    const d = await disp(A);
    expect(d.map((x: any) => x.state)).toEqual(['submitted']);
    expect(d[0].occurrence_key).toBe(occurrenceKey(local(start).date, local(start).time));
    expect(d[0].notification_id).toBeTruthy();
    expect(sent.filter((x) => x.source?.id === A)).toHaveLength(1);
    expect((await q(`select status from appointment_reminder_attempts where dispatch_id = $1 order by id`, [d[0].id])).map((x: any) => x.status)).toEqual(['claimed', 'sent']);
    expect((await q(`select outcome from appointment_reminder_runs where tenant_id = $1 order by started_at desc limit 1`, [T]))[0].outcome).toBe('ok');
  });
  it('another run (and two at once) never sends it again', async () => {
    await run(Date.now()); await Promise.all([run(Date.now()), run(Date.now())]);
    expect(sent.filter((x) => x.source?.id === A)).toHaveLength(1);
    expect(await disp(A)).toHaveLength(1);
  });
  it('P0: a CONFIRMED appointment (POS Confirm / customer reschedule) is reminded like a booked one', async () => {
    const c = await appt(start + 60_000, C4);
    await q(`update pos_tech_appointments set status = 'confirmed' where id = $1`, [c]);
    await run(Date.now());
    expect((await disp(c)).map((x: any) => x.state)).toEqual(['submitted']);
    expect(sent.filter((x) => x.source?.id === c)).toHaveLength(1);
  });
  it('§4.1 rescheduled after the reminder went out: the NEW time gets its own reminder; the old record stays, marked superseded', async () => {
    const ns = start + 2 * H; const l = local(ns);
    const [hh, mm] = l.time.split(':').map(Number); const e = Math.min(hh * 60 + mm + 45, 23 * 60 + 59);
    await q(`update pos_tech_appointments set appt_date = $2::date, start_time = $3, end_time = $4 where id = $1`, [A, l.date, l.time, `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`]);
    await run(ns - 24 * H - 30 * M);
    const d = await disp(A);
    expect(d.map((x: any) => x.state)).toEqual(['submitted', 'submitted']);
    expect(d[1].occurrence_key).toBe(occurrenceKey(l.date, l.time));
    expect(sent.filter((x) => x.source?.id === A)).toHaveLength(2);
    const hist = await center.list(ctx, { tab: 'all', q: A });
    expect(hist.items.find((x: any) => x.occurrenceKey === d[0].occurrence_key)?.superseded).toBe(true);
    expect(hist.items.find((x: any) => x.occurrenceKey === d[1].occurrence_key)?.superseded).toBe(false);
  });
  it('§4.1 cancelled after the claim but before the provider call: never sent, recorded as cancelled (appointment_changed)', async () => {
    const st = Date.now() + 24 * H + 20 * M; const a = await appt(st, C4); const l = local(st);
    const c: any = await repo.dispatch.claim({ tenantId: T, appointmentId: a, leadMinutes: 1440, occurrenceKey: occurrenceKey(l.date, l.time), channel: 'sms', branchId: B, customerId: C4, intendedSendAtMs: st - 24 * H, apptStartMs: st, tz: TZ, state: 'claimed', reason: null });
    expect(c.state).toBe('claimed');
    await q(`update pos_tech_appointments set status = 'cancelled' where id = $1`, [a]);
    const cand = { appointmentId: a, startsAtMs: st, status: 'booked', address: '+16095550188', apptDate: l.date, startTime: l.time, customerId: C4 };
    expect(await svc.sendClaimed(repo.dispatch, T, c.id, cand as any, 'sms', 'RMCA', 1440, TZ, Date.now(), { kind: 'automatic' })).toBe('cancelled');
    expect(sent.filter((x) => x.source?.id === a)).toHaveLength(0);
    expect((await disp(a))[0]).toMatchObject({ state: 'cancelled', reason: 'appointment_changed' });
    // and a cancelled appointment is never claimed at all
    expect(await repo.dispatch.claim({ tenantId: T, appointmentId: a, leadMinutes: 60, occurrenceKey: occurrenceKey(l.date, l.time), channel: 'sms', branchId: B, customerId: C4, intendedSendAtMs: st - H, apptStartMs: st, tz: TZ, state: 'claimed', reason: null })).toEqual({ stale: true });
  });
});

describe('timing, consent and destinations (guide §7.2, §9, §16 Consent)', () => {
  it('DST: an appointment the day clocks spring forward is reminded exactly 24 h (real time) before it', async () => {
    const start = Date.UTC(2027, 2, 14, 13, 0);          // Sun Mar 14 2027 09:00 EDT — the night clocks go forward
    expect(local(start)).toEqual({ date: '2027-03-14', time: '09:00' });
    const a = await appt(start, C1);
    await run(start - 24 * H - 10 * M);
    const d = (await q(`select state, intended_send_at, appt_start_at from appointment_reminders_sent where appointment_id = $1`, [a]))[0];
    expect(d.state).toBe('submitted');
    expect(new Date(d.appt_start_at).getTime() - new Date(d.intended_send_at).getTime()).toBe(24 * H);
    expect(new Date(d.appt_start_at).toISOString()).toBe('2027-03-14T13:00:00.000Z');
    expect(local(new Date(d.intended_send_at).getTime())).toEqual({ date: '2027-03-13', time: '08:00' });   // still EST the day before
  });
  it('outside the window (too early / already past the lead) nothing is claimed', async () => {
    const start = Date.now() + 26 * H; const a = await appt(start, C1);
    await run(Date.now());
    expect(await disp(a)).toHaveLength(0);
  });
  it('opted out (STOP) → skipped opted_out, never retryable; no phone → skipped no_destination', async () => {
    const st = Date.now() + 24 * H + 15 * M; const a = await appt(st, C3); const b = await appt(st, C2);
    await run(Date.now());
    expect((await disp(a))[0]).toMatchObject({ state: 'skipped', reason: 'opted_out' });
    expect((await disp(b))[0]).toMatchObject({ state: 'skipped', reason: 'no_destination' });
    const da = (await disp(a))[0].id;
    expect(await code(center.retry(ctx, da, { idempotencyKey: 'retry-optout-01', reason: 'customer asked', confirm: true }))).toBe('REMINDER_NOT_RETRYABLE');
  });
  it('quiet hours (Super Admin Smart Reminders default) defer the reminder, then it goes when they end; policy skip records skipped', async () => {
    const now = Date.now(); const m = localMinuteOfDay(now, TZ);
    await q(`insert into reminder_timing_defaults (tenant_id, reminder_type, quiet_hours_start, quiet_hours_end, quiet_hours_policy) values (null,'upcoming_appointment',$1,$2,'defer')`, [m, (m + 2) % 1440]);
    expect(inQuietHours(now, TZ, { start: m, end: (m + 2) % 1440, policy: 'defer' })).toBe(true);
    const st = now + 24 * H + 25 * M; const a = await appt(st, C4);
    await run(now);
    expect((await disp(a))[0]).toMatchObject({ state: 'deferred', reason: 'quiet_hours' });
    expect(sent.filter((x) => x.source?.id === a)).toHaveLength(0);
    await run(now + 3 * M);                                 // quiet hours over
    expect((await disp(a)).map((x: any) => x.state)).toEqual(['submitted']);
    expect(sent.filter((x) => x.source?.id === a)).toHaveLength(1);
    await q(`update reminder_timing_defaults set quiet_hours_policy = 'skip' where tenant_id is null and reminder_type = 'upcoming_appointment'`);
    const now2 = Date.now(); const m2 = localMinuteOfDay(now2, TZ);
    await q(`update reminder_timing_defaults set quiet_hours_start = $1, quiet_hours_end = $2 where tenant_id is null and reminder_type = 'upcoming_appointment'`, [m2, (m2 + 2) % 1440]);
    const b = await appt(now2 + 24 * H + 35 * M, C4);
    await run(now2);
    expect((await disp(b))[0]).toMatchObject({ state: 'skipped', reason: 'quiet_hours' });
    await q(`delete from reminder_timing_defaults where tenant_id is null and reminder_type = 'upcoming_appointment'`);
  });
});

describe('failures, bounded automatic retry, recovery and Safe Retry (guide §8, §11, §4.2)', () => {
  it('a provider error fails the reminder; the next run waits for the backoff; after it the run retries once and sends', async () => {
    const st = Date.now() + 24 * H + 40 * M; const a = await appt(st, C4);
    failNext = 'throw'; await run(Date.now());
    expect((await disp(a))[0]).toMatchObject({ state: 'failed', reason: 'provider_error', attempt_count: 1 });
    await run(Date.now());                                   // inside the 10-minute backoff: no resend
    expect((await disp(a))[0].state).toBe('failed');
    await q(`update appointment_reminders_sent set updated_at = now() - interval '11 minutes' where appointment_id = $1`, [a]);
    await run(Date.now());
    expect((await disp(a))[0]).toMatchObject({ state: 'submitted', attempt_count: 2 });
    expect(sent.filter((x) => x.source?.id === a)).toHaveLength(1);
  });
  it('an invalid number is not retried automatically; Safe Retry after the fix sends once; the same key again replays', async () => {
    const st = Date.now() + 24 * H + 45 * M; const a = await appt(st, C4);
    failNext = 'invalid_destination'; await run(Date.now());
    await q(`update appointment_reminders_sent set updated_at = now() - interval '2 hours' where appointment_id = $1`, [a]);
    await run(Date.now());
    const d = (await disp(a))[0];
    expect(d).toMatchObject({ state: 'failed', reason: 'invalid_destination', attempt_count: 1 });
    expect(await code(center.retry(ctx, d.id, { idempotencyKey: 'retry-key-0001', reason: 'number fixed' }))).toBe('REMINDER_CONFIRM_REQUIRED');
    expect(await code(center.retry(ctx, d.id, { idempotencyKey: 'retry-key-0001', confirm: true, reason: 'x' }))).toBe('REMINDER_REASON_REQUIRED');
    const r1: any = await center.retry(ctx, d.id, { idempotencyKey: 'retry-key-0001', confirm: true, reason: 'number fixed' });
    expect(r1).toMatchObject({ replayed: false, state: 'submitted' });
    const r2: any = await center.retry(ctx, d.id, { idempotencyKey: 'retry-key-0001', confirm: true, reason: 'number fixed' });
    expect(r2.replayed).toBe(true);
    expect(sent.filter((x) => x.source?.id === a)).toHaveLength(1);
    expect(await code(center.retry(ctx, d.id, { idempotencyKey: 'retry-key-0002', confirm: true, reason: 'again' }))).toBe('REMINDER_ALREADY_DELIVERED');
    const ev = await q(`select status, kind, actor_user_id from appointment_reminder_attempts where dispatch_id = $1 order by id`, [d.id]);
    expect(ev.map((x: any) => `${x.status}/${x.kind}`)).toEqual(['claimed/automatic', 'failed/automatic', 'retry_requested/manual_retry', 'sent/manual_retry']);
    expect((await q(`select count(*)::int c from audit_events where tenant_id = $1 and action = 'appointment_reminder.retried'`, [T]))[0].c).toBe(1);
  });
  it('a run interrupted mid-send: the next run marks it unknown (never auto-retried); retry needs the duplicate-risk acknowledgement', async () => {
    const st = Date.now() + 24 * H + 50 * M; const a = await appt(st, C4); const l = local(st);
    const c: any = await repo.dispatch.claim({ tenantId: T, appointmentId: a, leadMinutes: 1440, occurrenceKey: occurrenceKey(l.date, l.time), channel: 'sms', branchId: B, customerId: C4, intendedSendAtMs: st - 24 * H, apptStartMs: st, tz: TZ, state: 'claimed', reason: null });
    await q(`update appointment_reminders_sent set updated_at = now() - interval '20 minutes' where id = $1`, [c.id]);
    await run(Date.now());
    expect((await disp(a))[0]).toMatchObject({ state: 'failed', reason: 'interrupted_unknown' });
    expect(sent.filter((x) => x.source?.id === a)).toHaveLength(0);
    expect(await code(center.retry(ctx, c.id, { idempotencyKey: 'retry-unk-0001', confirm: true, reason: 'checked twilio' }))).toBe('REMINDER_CONFIRM_REQUIRED');
    expect(await center.retry(ctx, c.id, { idempotencyKey: 'retry-unk-0002', confirm: true, reason: 'checked twilio', acknowledgeDuplicateRisk: true })).toMatchObject({ state: 'submitted' });
  });
  it('Safe Retry is blocked while the SMS sender is not ready (missing sender / failed check)', async () => {
    const st = Date.now() + 24 * H + 55 * M; const a = await appt(st, C4);
    failNext = 'not_configured'; await run(Date.now());
    const d = (await disp(a))[0];
    await q(`update tenant_messaging_credentials set last_validation_error = 'auth failed' where tenant_id = $1`, [T]);
    expect(await code(center.retry(ctx, d.id, { idempotencyKey: 'retry-prov-001', confirm: true, reason: 'sender fixed?' }))).toBe('REMINDER_PROVIDER_NOT_READY');
    const h = await center.health(ctx);
    expect(h.items.find((i) => i.key === 'twilio')?.state).toBe('failed');
    expect(h.overall).toBe('failed');
    await q(`update tenant_messaging_credentials set last_validation_error = null where tenant_id = $1`, [T]);
  });
});

describe('staff Cancel Pending, KPIs, list, health, customer history, isolation (guide §4–§6, §10, §14, §15)', () => {
  let UP: string;
  it('Upcoming is derived, earliest due first; a short-notice booking is shown as such, never sent late', async () => {
    UP = await appt(Date.now() + 30 * H, C1);
    const sn = await appt(Date.now() + 3 * H, C1, { createdAt: new Date().toISOString() });
    const l = await center.list(ctx, { tab: 'upcoming', pageSize: 50 });
    const ix = l.items.map((x: any) => x.intendedSendAt);
    expect([...ix].sort()).toEqual(ix);
    expect(l.items.find((x: any) => x.appointmentId === UP)).toMatchObject({ state: 'scheduled', channel: 'sms', phoneLast4: '0142', leadMinutes: 1440 });
    expect(l.items.find((x: any) => x.appointmentId === sn)?.state).toBe('short_notice');
  });
  it('Cancel Pending (staff, with a reason, audited): the sweep never sends it; a second cancel is refused', async () => {
    const u = `u:${UP}:1440`;
    expect(await code(center.cancelPending(ctx, u, 'x'))).toBe('REMINDER_REASON_REQUIRED');
    expect(await center.cancelPending(ctx, u, 'customer asked for no texts')).toMatchObject({ state: 'cancelled' });
    expect(await code(center.cancelPending(ctx, u, 'customer asked for no texts'))).toBe('REMINDER_NOT_CANCELLABLE');
    await run(Date.now() + 6 * H + 10 * M);
    expect(sent.filter((x) => x.source?.id === UP)).toHaveLength(0);
    expect((await disp(UP))[0]).toMatchObject({ state: 'cancelled', reason: 'staff_cancelled' });
  });
  it('KPIs: real counts on written bases; Delivered is Unknown (null) until a delivery report arrives', async () => {
    const k1 = await center.kpis(ctx, { preset: 'today' });
    expect(k1.sent.value).toBeGreaterThanOrEqual(4);
    expect(k1.delivered).toMatchObject({ value: null, known: false });
    expect(k1.failed.value).toBeGreaterThanOrEqual(1);
    expect(k1.cancelled.value).toBeGreaterThanOrEqual(2);
    const one = (await q(`select notification_id from appointment_reminders_sent where tenant_id = $1 and state = 'submitted' and notification_id is not null limit 1`, [T]))[0].notification_id;
    await q(`update notifications set status = 'delivered', delivered_at = now() where id = $1`, [one]);
    await q(`insert into notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, applied, signature_verified) values ($1,$2,'SMx','delivered',true,true)`, [T, one]);
    const k2 = await center.kpis(ctx, { preset: 'today' });
    expect(k2.delivered).toMatchObject({ value: 1, known: true });
    expect((await center.list(ctx, { tab: 'delivered' })).items.map((x: any) => x.notificationId)).toEqual([one]);
  });
  it('history: newest created first, 10 per page with exact totals; search by name, phone digits, email, technician, appointment id — beyond page 1', async () => {
    const all = await center.list(ctx, { tab: 'all', pageSize: 10 });
    expect(all.totalItems).toBeGreaterThan(10);
    const p2 = await center.list(ctx, { tab: 'all', pageSize: 10, page: 2 });
    expect(p2.items.length).toBeGreaterThan(0);
    const created = [...all.items, ...p2.items].map((x: any) => x.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    const oldest = (await q(`select appointment_id from appointment_reminders_sent where tenant_id = $1 order by created_at asc, id asc limit 1`, [T]))[0].appointment_id;
    expect((await center.list(ctx, { tab: 'all', q: oldest })).items.every((x: any) => x.appointmentId === oldest)).toBe(true);
    expect((await center.list(ctx, { tab: 'all', q: 'Dan Moss' })).totalItems).toBeGreaterThan(0);
    expect((await center.list(ctx, { tab: 'all', q: '555-0188' })).items.every((x: any) => x.phoneLast4 === '0188')).toBe(true);
    expect((await center.list(ctx, { tab: 'all', q: 'dan@rm' })).totalItems).toBeGreaterThan(0);
    expect((await center.list(ctx, { tab: 'all', q: 'Lina' })).totalItems).toBe(all.totalItems);
    expect((await center.list(ctx, { tab: 'skipped' })).items.every((x: any) => ['skipped', 'deferred'].includes(x.state))).toBe(true);
    expect(await code(center.list(ctx, { tab: 'all', preset: 'custom', from: '2026-11-02', to: '2026-11-01' }))).toBe('REMINDER_INVALID_FILTER');
    const future = await center.list(ctx, { tab: 'all', basis: 'appointment', preset: 'custom', from: '2027-03-14', to: '2027-03-14' });
    expect(future.items.map((x: any) => x.occurrenceKey)).toEqual(['2027-03-14 09:00']);
  });
  it('details: rule, template source, attempts with reasons and provider events; customer history newest first with each trail', async () => {
    const d = (await q(`select id from appointment_reminders_sent where tenant_id = $1 and reason is null and state = 'submitted' order by created_at desc limit 1`, [T]))[0].id;
    const det: any = await center.details(ctx, d);
    expect(det.rule).toMatchObject({ enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
    expect(det.template.source).toBe('built_in');
    expect(det.attempts.map((x: any) => x.status)).toContain('sent');
    const h: any = await center.customerHistory(ctx, C4, 1, 10);
    expect(h.totalItems).toBeGreaterThanOrEqual(5);
    const c = h.items.map((x: any) => x.createdAt); expect([...c].sort().reverse()).toEqual(c);
    expect(h.items.every((x: any) => Array.isArray(x.events) && x.events.length >= 1)).toBe(true);
  });
  it('health: the scheduler part reads the durable run record; reminders off → Off', async () => {
    const h = await center.health(ctx);
    expect(h.items.map((i) => i.key)).toEqual(['scheduler', 'twilio', 'email', 'booking_sync', 'history']);
    expect(h.items[0].checkedAt).toBeTruthy();
    await q(`update reminder_settings set enabled = false where tenant_id = $1`, [T]);
    expect((await center.health(ctx)).items[0].state).toBe('off');
    await q(`update reminder_settings set enabled = true where tenant_id = $1`, [T]);
  });
  it('tenant isolation: another salon sees none of these, cannot open or act on them, nor read this customer', async () => {
    const mine = (await q(`select id from appointment_reminders_sent where tenant_id = $1 limit 1`, [T]))[0].id;
    expect((await center.list(ctx2, { tab: 'all' })).totalItems).toBe(0);
    expect(await code(center.details(ctx2, mine))).toBe('REMINDER_NOT_FOUND');
    expect(await code(center.retry(ctx2, mine, { idempotencyKey: 'retry-iso-0001', confirm: true, reason: 'not mine' }))).toBe('REMINDER_NOT_FOUND');
    expect(await code(center.cancelPending(ctx2, mine, 'not mine either'))).toBe('REMINDER_NOT_CANCELLABLE');
    expect(await code(center.customerHistory(ctx2, C4))).toBe('REMINDER_NOT_FOUND');
    expect((await center.kpis(ctx2, { preset: 'today' })).sent.value).toBe(0);
  });
});
