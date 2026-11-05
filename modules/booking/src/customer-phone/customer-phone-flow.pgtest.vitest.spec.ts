// customer-phone-flow.pgtest — BUILD_PLAN Phase 3: the WHOLE phone change through the real service and the real SQL.
//
// The audit's E1: every existing test either mocked the store (the service tests) or passed the pending row's id by
// hand (the store pgtest) — so none of them noticed that the session never remembered WHICH row it was activating.
// `newPhoneId ?? ''` reached `id <> ''`, Postgres refused it, `.catch(() => false)` turned that into a false
// VERSION_CONFLICT, and every SMS-verified change in production stopped at `phone_verified`. This drives start → send
// → verify → activate exactly as the controllers do, with only the SMS provider faked.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { phoneKey } from '@aipowersalon/customers';
import { OutboxWriter } from '@aipowersalon/events';
import { CustomerPhoneUpdateService, PhoneUpdateError, type VerificationPort } from './customer-phone-update.service';
import { KyselyPhoneStore, KyselySyncPort } from './customer-phone.kysely';
import { KyselyPhoneNotifier } from './customer-phone-notify';

const T = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const U = '44444444-4444-4444-8444-444444444444';
let db: any;

/** The SMS provider is the only fake: it accepts the code '123456' for whatever number it texted. */
function fakeOtp(): VerificationPort & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async send(_ctx, phone) { sent.push(phone); return { status: 'code_sent', message: 'Code sent.' }; },
    async check(_ctx, phone, code) { return sent.includes(phone) && code === '123456' ? { status: 'phone_verified', message: 'ok' } : { status: 'code_invalid', message: 'wrong code' }; },
  };
}
const ctx = (role: any = 'RECEPTION', source: any = 'staff_pos') => ({ tenantId: T, branchId: B, userId: U, role, source });
let seq = 0;
async function customer(phone: string | null, verified = false): Promise<string> {
  const id = (await sql<{ id: string }>`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at)
    values (${T}, ${B}, 'Flow', ${'Person' + ++seq}, ${'Flow Person' + seq}, ${phone}, ${phone}, ${verified ? sql`now()` : null}) returning id`.execute(db)).rows[0].id;
  return String(id);
}
const service = (otp = fakeOtp()) => ({ otp, svc: new CustomerPhoneUpdateService(new KyselyPhoneStore(db, new OutboxWriter()), otp, new KyselySyncPort(db)) });

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'Flow LLC', 'Flow', 'flow-salon', 'FLOW01', 'ACTIVE') on conflict do nothing`.execute(db);
  await sql`update tenants set lifecycle_state = 'ACTIVE', status = 'active' where id = ${T}`.execute(db).catch(() => undefined);
  await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'UTC') on conflict do nothing`.execute(db);
}, 180_000);
beforeEach(() => { seq += 0; });

describe('E1 — an SMS-verified change actually activates', () => {
  it('start → send → verify activates the new number and retires the old one', async () => {
    const C = await customer('+18565550101', true);
    const { svc } = service();
    const started = await svc.start(ctx(), { customerId: C, newPhone: '(856) 555-0199' });
    expect(started.state).toBe('pending_phone_saved');
    await svc.sendCode(ctx(), started.sessionId, '+18565550199', C);
    const done = await svc.verify(ctx(), started.sessionId, '+18565550199', '123456', C);
    expect(done.activated).toBe(true);
    const c: any = (await sql`select normalized_phone, phone_display, phone_verified_at, record_version from customers where id = ${C}`.execute(db)).rows[0];
    expect(c.normalized_phone).toBe('+18565550199');
    const phones: any[] = (await sql`select normalized_phone, status from customer_phones where customer_id = ${C} order by created_at`.execute(db)).rows;
    expect(phones.find((p) => p.normalized_phone === '+18565550199')?.status).toBe('active_verified');
    expect(phones.find((p) => p.normalized_phone === '+18565550101')?.status).toBe('replaced');   // the legacy number, adopted then retired
    const s: any = (await sql`select state, completed_at, new_phone_id from customer_phone_update_sessions where id = ${started.sessionId}`.execute(db)).rows[0];
    expect(s.state).toBe('customer_records_synchronized');
    expect(s.completed_at).not.toBeNull();
    expect(s.new_phone_id).not.toBeNull();
  });
});

describe('E4 / E7 — what the customer row says afterwards', () => {
  it('phone_display is the readable number, never the mask; phone_verified_at follows the proof', async () => {
    const C = await customer('+18565550102', false);
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '8565550198' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550198', C);
    await svc.verify(ctx(), s.sessionId, '+18565550198', '123456', C);
    const c: any = (await sql`select phone_display, phone_verified_at from customers where id = ${C}`.execute(db)).rows[0];
    expect(c.phone_display).toBe('(856) 555-0198');
    expect(c.phone_display).not.toContain('•');
    expect(c.phone_verified_at).not.toBeNull();
  });

  it('the OLD number’s booking verification is revoked', async () => {
    const C = await customer('+18565550103', true);
    await sql`insert into booking_verified_phones (tenant_id, customer_id, phone_hash, phone_mask, provider) values (${T}, ${C}, ${phoneKey('+18565550103')}, '••••0103', 'twilio_verify')`.execute(db);
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550197' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550197', C);
    await svc.verify(ctx(), s.sessionId, '+18565550197', '123456', C);
    const old: any = (await sql`select revoked_at from booking_verified_phones where tenant_id = ${T} and phone_hash = ${phoneKey('+18565550103')}`.execute(db)).rows[0];
    expect(old.revoked_at).not.toBeNull();
  });

  it('a change without SMS (tenant policy) leaves phone_verified_at empty — the number was never proved', async () => {
    const C = await customer('+18565550104', true);
    await sql`insert into tenant_customer_phone_settings (tenant_id, require_sms_verification) values (${T}, false) on conflict do nothing`.execute(db);
    try {
      const { svc } = service();
      const r = await svc.start(ctx(), { customerId: C, newPhone: '+18565550196' });
      expect(r.state).toBe('phone_activated');
      const c: any = (await sql`select phone_display, phone_verified_at from customers where id = ${C}`.execute(db)).rows[0];
      expect(c.phone_verified_at).toBeNull();
      expect(c.phone_display).toBe('(856) 555-0196');
    } finally {
      await sql`delete from tenant_customer_phone_settings where tenant_id = ${T}`.execute(db);
    }
  });
});

describe('E2 / E11 — sessions end, and an ended one blocks nobody', () => {
  it('a canceled change does not block the next one, and its number is not a "duplicate"', async () => {
    const C = await customer('+18565550105');
    const D = await customer('+18565550106');
    const { svc } = service();
    const first = await svc.start(ctx(), { customerId: C, newPhone: '+18565550195' });
    await svc.cancel(ctx(), first.sessionId, C);
    // Another customer may now take the number C abandoned: the canceled pending row is retired, not a match.
    const other = await svc.start(ctx(), { customerId: D, newPhone: '+18565550195' });
    expect(other.duplicates.outcome).toBe('no_conflict');
    const second = await svc.start(ctx(), { customerId: C, newPhone: '+18565550194' });
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('starting again while a change is open resumes the same proposal, or replaces a different one', async () => {
    const C = await customer('+18565550107');
    const { svc } = service();
    const a = await svc.start(ctx(), { customerId: C, newPhone: '+18565550193' });
    const again = await svc.start(ctx(), { customerId: C, newPhone: '+18565550193' });
    expect(again.sessionId).toBe(a.sessionId);
    const different = await svc.start(ctx(), { customerId: C, newPhone: '+18565550192' });
    expect(different.sessionId).not.toBe(a.sessionId);
    const old: any = (await sql`select state, completed_at from customer_phone_update_sessions where id = ${a.sessionId}`.execute(db)).rows[0];
    expect(old.state).toBe('update_canceled');
    expect(old.completed_at).not.toBeNull();
  });

  it('a replayed request with the same idempotency key returns the same session (not a 500)', async () => {
    const C = await customer('+18565550108');
    const { svc } = service();
    const a = await svc.start(ctx(), { customerId: C, newPhone: '+18565550191', idempotencyKey: 'replay-key-1' });
    const b = await svc.start(ctx(), { customerId: C, newPhone: '+18565550191', idempotencyKey: 'replay-key-1' });
    expect(b.sessionId).toBe(a.sessionId);
  });

  it('an expired, unproven session is closed by the expiry sweep and its pending number retired', async () => {
    const C = await customer('+18565550109');
    const { svc } = service();
    const a = await svc.start(ctx(), { customerId: C, newPhone: '+18565550190' });
    await sql`update customer_phone_update_sessions set expires_at = now() - interval '1 minute' where id = ${a.sessionId}`.execute(db);
    const n = await new KyselyPhoneStore(db).expireStaleSessions(100);
    expect(n).toBeGreaterThanOrEqual(1);
    const s: any = (await sql`select state, completed_at from customer_phone_update_sessions where id = ${a.sessionId}`.execute(db)).rows[0];
    expect(s.state).toBe('verification_expired');
    expect(s.completed_at).not.toBeNull();
    const p: any = (await sql`select status from customer_phones where customer_id = ${C} and normalized_phone = '+18565550190'`.execute(db)).rows[0];
    expect(p.status).toBe('verification_expired');
  });
});

describe('E15 — a session belongs to ONE customer', () => {
  it('another customer’s id cannot drive this customer’s session', async () => {
    const C = await customer('+18565550110');
    const D = await customer('+18565550111');
    const { svc } = service();
    const a = await svc.start(ctx(), { customerId: C, newPhone: '+18565550189' });
    await expect(svc.sendCode(ctx(), a.sessionId, '+18565550189', D)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.verify(ctx(), a.sessionId, '+18565550189', '123456', D)).rejects.toBeInstanceOf(PhoneUpdateError);
    await expect(svc.cancel(ctx(), a.sessionId, D)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the phone module’s work is on the ONE job queue', () => {
  it('starting a change queues its expiry job at the deadline; the job closes it once expired', async () => {
    const { registerPhoneJobHandlers } = await import('./customer-phone-sync.scheduler');
    const { jobHandlerFor } = await import('@aipowersalon/database');
    registerPhoneJobHandlers(db);
    const C = await customer('+18565550112');
    const { svc } = service();
    const a = await svc.start(ctx(), { customerId: C, newPhone: '+18565550188' });
    const job: any = (await sql`select job_type, run_after, payload, tenant_id from jobs where idempotency_key = ${a.sessionId}`.execute(db)).rows[0];
    expect(job.job_type).toBe('customer.phone.session_expiry');
    expect(job.tenant_id).toBe(T);
    const sess: any = (await sql`select expires_at from customer_phone_update_sessions where id = ${a.sessionId}`.execute(db)).rows[0];
    expect(new Date(job.run_after).getTime()).toBe(new Date(sess.expires_at).getTime());
    const run = (p: any) => jobHandlerFor('customer.phone.session_expiry')!(p, { jobId: 'j', tenantId: T, attempt: 1, correlationId: null, renewLease: async () => true });
    expect(await run({ sessionId: a.sessionId })).toEqual({ expired: false });          // not yet due: untouched
    await sql`update customer_phone_update_sessions set expires_at = now() - interval '1 second' where id = ${a.sessionId}`.execute(db);
    expect(await run({ sessionId: a.sessionId })).toEqual({ expired: true });
  });

  it('a failed synchronisation becomes a retryable job that finishes the session when it succeeds', async () => {
    const { registerPhoneJobHandlers } = await import('./customer-phone-sync.scheduler');
    const { jobHandlerFor } = await import('@aipowersalon/database');
    registerPhoneJobHandlers(db);
    const C = await customer('+18565550113');
    const otp = fakeOtp();
    const svc = new CustomerPhoneUpdateService(new KyselyPhoneStore(db), otp, { async synchronize() { return false; } });
    const a = await svc.start(ctx(), { customerId: C, newPhone: '+18565550187' });
    await svc.sendCode(ctx(), a.sessionId, '+18565550187', C);
    const r = await svc.verify(ctx(), a.sessionId, '+18565550187', '123456', C);
    expect(r.state).toBe('synchronization_failed');
    const job: any = (await sql`select job_type, max_attempts from jobs where idempotency_key = ${'sync:' + a.sessionId}`.execute(db)).rows[0];
    expect(job).toMatchObject({ job_type: 'customer.phone.sync', max_attempts: 8 });
    await jobHandlerFor('customer.phone.sync')!({ sessionId: a.sessionId }, { jobId: 'j', tenantId: T, attempt: 1, correlationId: null, renewLease: async () => true });
    const s: any = (await sql`select state, completed_at from customer_phone_update_sessions where id = ${a.sessionId}`.execute(db)).rows[0];
    expect(s.state).toBe('customer_records_synchronized');
    expect(s.completed_at).not.toBeNull();
  });
});

describe('E5 — the proof the sign-in change looks up', () => {
  it('only this customer’s own app change, SMS-proven, of this exact number, counts', async () => {
    const { provenRecentlyQuery } = await import('./customer-identity-phone.kysely');
    const userId = (await sql<{ id: string }>`insert into users (tenant_id, first_name, last_name, full_name, email, status, role)
      values (${T}, 'App', 'User', 'App User', ${'app-' + Date.now() + '@flow.test'}, 'active', 'CUSTOMER') returning id`.execute(db)).rows[0].id;
    const C = await customer('+18565550114');
    await sql`update customers set user_id = ${userId} where id = ${C}`.execute(db);
    const { svc } = service();
    const app = ctx('CUSTOMER', 'customer_app');
    expect(await provenRecentlyQuery(db, userId, phoneKey('+18565550186'), 30)).toBe(false);
    const a = await svc.start(app, { customerId: C, newPhone: '+18565550186', reauth: 'ok' });
    await svc.sendCode(app, a.sessionId, '+18565550186', C);
    expect(await provenRecentlyQuery(db, userId, phoneKey('+18565550186'), 30)).toBe(false);   // sent, not proven
    await svc.verify(app, a.sessionId, '+18565550186', '123456', C);
    expect(await provenRecentlyQuery(db, userId, phoneKey('+18565550186'), 30)).toBe(true);
    expect(await provenRecentlyQuery(db, userId, phoneKey('+18565550185'), 30)).toBe(false);   // another number
    expect(await provenRecentlyQuery(db, U, phoneKey('+18565550186'), 30)).toBe(false);        // another user
    await sql`update customer_phone_update_sessions set updated_at = now() - interval '2 hours' where id = ${a.sessionId}`.execute(db);
    expect(await provenRecentlyQuery(db, userId, phoneKey('+18565550186'), 30)).toBe(false);   // too old
  });

  it('a STAFF change of the same number is not the customer’s proof', async () => {
    const { provenRecentlyQuery } = await import('./customer-identity-phone.kysely');
    const userId = (await sql<{ id: string }>`insert into users (tenant_id, first_name, last_name, full_name, email, status, role)
      values (${T}, 'Staff', 'Changed', 'Staff Changed', ${'staff-' + Date.now() + '@flow.test'}, 'active', 'CUSTOMER') returning id`.execute(db)).rows[0].id;
    const C = await customer('+18565550115');
    await sql`update customers set user_id = ${userId} where id = ${C}`.execute(db);
    const { svc } = service();
    const a = await svc.start(ctx(), { customerId: C, newPhone: '+18565550184' });
    await svc.sendCode(ctx(), a.sessionId, '+18565550184', C);
    await svc.verify(ctx(), a.sessionId, '+18565550184', '123456', C);
    expect(await provenRecentlyQuery(db, userId, phoneKey('+18565550184'), 30)).toBe(false);
  });
});

describe('E8 / E14 — what else follows the number', () => {
  it('future appointments move to the new number, and reminders read the customer’s current number', async () => {
    const { KyselyRemindersRepository } = await import('@aipowersalon/communications');
    const C = await customer('+18565550116', true);
    const tech = (await sql<{ id: string }>`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, status) values (${T}, ${B}, 'Tia', 'Tech', 'Tia Tech', 'active') returning id`.execute(db)).rows[0].id;
    const future = (await sql<{ id: string }>`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, appt_date, start_time, end_time, status)
      values (${T}, ${B}, ${tech}, ${C}, 'Flow', '+18565550116', current_date + 3, '10:00', '11:00', 'booked') returning id`.execute(db)).rows[0].id;
    const past = (await sql<{ id: string }>`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, appt_date, start_time, end_time, status)
      values (${T}, ${B}, ${tech}, ${C}, 'Flow', '+18565550116', current_date - 3, '10:00', '11:00', 'completed') returning id`.execute(db)).rows[0].id;
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550183' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550183', C);
    await svc.verify(ctx(), s.sessionId, '+18565550183', '123456', C);
    const rows: any[] = (await sql`select id, customer_phone from pos_tech_appointments where id in (${future}, ${past})`.execute(db)).rows;
    expect(rows.find((r) => r.id === future).customer_phone).toBe('+18565550183');
    expect(rows.find((r) => r.id === past).customer_phone).toBe('+18565550116');       // history keeps its contact
    // An appointment whose copy is stale (written by some other path) still reminds the CURRENT number.
    await sql`update pos_tech_appointments set customer_phone = '+18565550116' where id = ${future}`.execute(db);
    const day = (await sql<{ d: string }>`select to_char(current_date + 3, 'YYYY-MM-DD') as d`.execute(db)).rows[0].d;
    const due = await new KyselyRemindersRepository(db).dueCandidates(T, day, day);
    expect(due.find((d: any) => d.appointmentId === future)?.customerPhone).toBe('+18565550183');
  });

  it('a customer waiting in TODAY’s queue is called on the new number; finished queue entries keep theirs', async () => {
    const C = await customer('+18565550117', true);
    const tech = (await sql<{ id: string }>`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, status) values (${T}, ${B}, 'Qia', 'Queue', 'Qia Queue', 'active') returning id`.execute(db)).rows[0].id;
    const waiting = (await sql<{ id: string }>`insert into pos_queue_items (tenant_id, branch_id, customer_id, customer_name, customer_phone, status) values (${T}, ${B}, ${C}, 'Flow', '+18565550117', 'waiting') returning id`.execute(db)).rows[0].id;
    const done = (await sql<{ id: string }>`insert into pos_queue_items (tenant_id, branch_id, customer_id, customer_name, customer_phone, status) values (${T}, ${B}, ${C}, 'Flow', '+18565550117', 'done') returning id`.execute(db)).rows[0].id;
    const ticket = (await sql<{ id: string }>`insert into pos_tech_queue_tickets (tenant_id, branch_id, customer_id, customer_name, customer_phone, status, assigned_technician_id) values (${T}, ${B}, ${C}, 'Flow', '+18565550117', 'accepted', ${tech}) returning id`.execute(db)).rows[0].id;
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550161' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550161', C);
    await svc.verify(ctx(), s.sessionId, '+18565550161', '123456', C);
    const q: any[] = (await sql`select id, customer_phone from pos_queue_items where id in (${waiting}, ${done})`.execute(db)).rows;
    expect(q.find((r) => r.id === waiting).customer_phone).toBe('+18565550161');
    expect(q.find((r) => r.id === done).customer_phone).toBe('+18565550117');
    expect((await sql`select customer_phone from pos_tech_queue_tickets where id = ${ticket}`.execute(db)).rows[0]).toMatchObject({ customer_phone: '+18565550161' });
  });

  it('SMS consent: a customer who texted STOP stays opted out on the new number; marketing flags are untouched; no opt-out is invented', async () => {
    const C = await customer('+18565550162', true);
    await sql`update customers set marketing_sms_opt_in = false where id = ${C}`.execute(db);
    await sql`insert into notification_opt_outs (tenant_id, channel, address, reason) values (${T}, 'sms', '+18565550162', 'stop_keyword')`.execute(db);
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550163' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550163', C);
    await svc.verify(ctx(), s.sessionId, '+18565550163', '123456', C);
    const outs: any[] = (await sql`select address, reason from notification_opt_outs where tenant_id = ${T} and channel = 'sms' and address in ('+18565550162', '+18565550163') order by address`.execute(db)).rows;
    expect(outs.map((o) => o.address)).toEqual(['+18565550162', '+18565550163']);   // the old number's STOP stays; the new one inherits it
    expect(outs[1].reason).toBe('carried_from_previous_number');
    expect((await sql`select marketing_sms_opt_in from customers where id = ${C}`.execute(db)).rows[0]).toMatchObject({ marketing_sms_opt_in: false });
    // A customer who never opted out gets no opt-out from a change.
    const D = await customer('+18565550171', true);
    const d = await svc.start(ctx(), { customerId: D, newPhone: '+18565550172' });
    await svc.sendCode(ctx(), d.sessionId, '+18565550172', D);
    await svc.verify(ctx(), d.sessionId, '+18565550172', '123456', D);
    expect((await sql`select count(*)::int as n from notification_opt_outs where tenant_id = ${T} and address = '+18565550172'`.execute(db)).rows[0]).toMatchObject({ n: 0 });
  });

  it('a number staff entered WITHOUT an SMS is not an account-claim key; once proved it is', async () => {
    const { KyselyActivationRepo } = await import('../customer-activation/customer-activation.repository');
    const C = await customer('+18565550117');
    await sql`insert into tenant_customer_phone_settings (tenant_id, require_sms_verification) values (${T}, false) on conflict do nothing`.execute(db);
    try {
      await service().svc.start(ctx(), { customerId: C, newPhone: '+18565550182' });
    } finally {
      await sql`delete from tenant_customer_phone_settings where tenant_id = ${T}`.execute(db);
    }
    const repo = new KyselyActivationRepo(db);
    expect((await repo.findByPhone('+18565550182')).map((m) => m.customerId)).not.toContain(C);
    // Proved by SMS (a later change to the same number through the code flow): now it is this customer's claim key.
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550182' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550182', C);
    await svc.verify(ctx(), s.sessionId, '+18565550182', '123456', C);
    expect((await repo.findByPhone('+18565550182')).map((m) => m.customerId)).toContain(C);
  });
});

describe('the change is told to the rest of the platform (customer.phone_*)', () => {
  it('requested → verified → activated → synchronised, each with its fact; never a full number or a code', async () => {
    const C = await customer('+18565550118', true);
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550181' });
    await svc.verify(ctx(), s.sessionId, '+18565550181', '999999', C).catch(() => undefined);   // not sent yet: refused
    await svc.sendCode(ctx(), s.sessionId, '+18565550181', C);
    await svc.verify(ctx(), s.sessionId, '+18565550181', '000000', C);                          // wrong code
    await svc.verify(ctx(), s.sessionId, '+18565550181', '123456', C);
    const ev: any[] = (await sql`select event_type, payload_json from outbox_events where tenant_id = ${T} and aggregate_id = ${C} order by occurred_at, event_type`.execute(db)).rows;
    expect(ev.map((e) => e.event_type)).toEqual(expect.arrayContaining([
      'customer.phone_update_requested', 'customer.phone_verification_failed', 'customer.phone_verified', 'customer.phone_activated', 'customer.phone_sync_completed',
    ]));
    const blob = JSON.stringify(ev);
    expect(blob).not.toMatch(/8565550181|8565550118|123456|000000/);
    expect(ev.find((e) => e.event_type === 'customer.phone_activated').payload_json).toMatchObject({ method: 'sms_otp', status: 'active_verified', newPhoneMasked: '••••0181' });
  });
});

describe('who hears about it', () => {
  const messenger = () => { const sent: any[] = []; return { sent, async sendSms(r: any) { sent.push(r); return { sent: true, status: 'sent' as const, providerId: 'SM1' }; } }; };
  const withNotify = (m: any) => new CustomerPhoneUpdateService(new KyselyPhoneStore(db, new OutboxWriter()), fakeOtp(), new KyselySyncPort(db), undefined, new KyselyPhoneNotifier(db, m));

  it('the OLD number is told (masked, on the salon’s number, account purpose) — never the new one', async () => {
    const m = messenger();
    const svc = withNotify(m);
    const C = await customer('+18565550119', true);
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550180' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550180', C);
    await svc.verify(ctx(), s.sessionId, '+18565550180', '123456', C);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ tenantId: T, to: '+18565550119', purpose: 'account', customerId: C });
    expect(m.sent[0].body).toContain('••••0180');
    expect(m.sent[0].body).not.toContain('8565550180');
  });

  it('two DIFFERENT numbers that end in the same four digits: the old one is still told — found by the live proof', async () => {
    const m = messenger();
    const svc = withNotify(m);
    const C = await customer('+18565570142', true);
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565580142' });
    await svc.sendCode(ctx(), s.sessionId, '+18565580142', C);
    await svc.verify(ctx(), s.sessionId, '+18565580142', '123456', C);
    expect(m.sent.map((x: any) => x.to)).toEqual(['+18565570142']);
  });

  it('the salon’s setting turns the old-number text off', async () => {
    const m = messenger();
    await sql`insert into tenant_customer_phone_settings (tenant_id, notify_old_number) values (${T}, false) on conflict do nothing`.execute(db);
    try {
      const svc = withNotify(m);
      const C = await customer('+18565550120', true);
      const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550179' });
      await svc.sendCode(ctx(), s.sessionId, '+18565550179', C);
      await svc.verify(ctx(), s.sessionId, '+18565550179', '123456', C);
      expect(m.sent).toHaveLength(0);
    } finally { await sql`delete from tenant_customer_phone_settings where tenant_id = ${T}`.execute(db); }
  });

  it('managers are alerted: a change waiting for approval, and a number set without SMS', async () => {
    await sql`insert into tenant_customer_phone_settings (tenant_id, require_manager_approval, require_sms_verification) values (${T}, true, false) on conflict do nothing`.execute(db);
    try {
      const svc = withNotify(messenger());
      const C = await customer('+18565550121', true);
      const s = await svc.start(ctx('RECEPTION'), { customerId: C, newPhone: '+18565550178' });
      expect(s.state).toBe('manager_review_required');
      await svc.approve(ctx('MANAGER'), s.sessionId, C);
      const alerts: any[] = (await sql`select title, severity, metadata from owner_alerts where tenant_id = ${T} and category = 'customer_phone' and metadata->>'customerId' = ${C} order by created_at`.execute(db)).rows;
      expect(alerts.map((a) => a.title)).toEqual([
        'A customer phone change is waiting for your approval',
        'A customer phone number was set without SMS verification',
      ]);
      const c: any = (await sql`select normalized_phone, phone_verified_at from customers where id = ${C}`.execute(db)).rows[0];
      expect(c).toMatchObject({ normalized_phone: '+18565550178', phone_verified_at: null });
    } finally { await sql`delete from tenant_customer_phone_settings where tenant_id = ${T}`.execute(db); }
  });
});

describe('status, and the numbers Super Admin sees (E13)', () => {
  it('status shows the number, its proof and the change in flight; the customer sees it masked', async () => {
    const C = await customer('+18565550122', false);
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550177' });
    const staff = await svc.status(ctx(), C);
    expect(staff.phone).toMatchObject({ display: '(856) 555-0122', verified: false, label: 'Not verified' });   // readable, even for a number stored raw
    expect(staff.openChange).toMatchObject({ sessionId: s.sessionId, state: 'pending_phone_saved', maskedPhone: '••••0177' });
    const mine = await svc.status(ctx('CUSTOMER', 'customer_app'), C);
    expect(mine.phone!.display).toBeNull();
    await svc.sendCode(ctx(), s.sessionId, '+18565550177', C);
    await svc.verify(ctx(), s.sessionId, '+18565550177', '123456', C);
    const after = await svc.status(ctx(), C);
    expect(after.phone).toMatchObject({ display: '(856) 555-0177', verified: true, label: 'Verified by SMS' });
    expect(after.openChange).toBeNull();
    expect(after.sync).toBe('ok');
  });

  it('oversight counts conflicts, manual vs no-SMS changes and salons with defaults — no numbers anywhere', async () => {
    const { KyselyPhoneOversight } = await import('./customer-phone-settings.kysely');
    const o = await new KyselyPhoneOversight(db).summary(24, T);
    expect(o.tenantsWithUpdatesEnabled).toBe(1);                      // no settings row: the default (ON) counts
    expect(o.changesWithoutSms).toBeGreaterThanOrEqual(1);           // the no-SMS policy tests above
    expect(o.manualConfirmations).toBeGreaterThanOrEqual(1);         // the manager-approval-without-SMS test above
    expect(o.verified).toBeGreaterThanOrEqual(5);
    expect(o.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(o)).not.toMatch(/\+1856|8565550/);
    const rows = await new KyselyPhoneOversight(db).byTenant(24);
    expect(rows.find((r) => r.tenantId === T)?.requested).toBeGreaterThan(0);
  });

  it('a duplicate the change went ahead with is counted', async () => {
    const { KyselyPhoneOversight } = await import('./customer-phone-settings.kysely');
    const before = (await new KyselyPhoneOversight(db).summary(24, T)).duplicateConflicts;
    const A = await customer('+18565550123');
    const Bc = await customer('+18565550124');
    await service().svc.start(ctx('MANAGER'), { customerId: Bc, newPhone: '+18565550123', staffAssertsSharedPhone: true });
    expect((await new KyselyPhoneOversight(db).summary(24, T)).duplicateConflicts).toBe(before + 1);
    expect(A).toBeTruthy();
  });
});

describe('"verify my phone number" (the legacy flow, merged into the canonical path)', () => {
  it('the customer proves the number already on file: same number, now active_verified, no password needed, no old-number text', async () => {
    const sent: any[] = [];
    const svc = new CustomerPhoneUpdateService(new KyselyPhoneStore(db, new OutboxWriter()), fakeOtp(), new KyselySyncPort(db), undefined,
      new KyselyPhoneNotifier(db, { async sendSms(r: any) { sent.push(r); return { sent: true, status: 'sent' as const }; } }));
    const C = await customer('+18565550125', false);
    const app = ctx('CUSTOMER', 'customer_app');
    expect(await svc.confirmCurrentVerification(app, C, '123456')).toEqual({ ok: false, message: 'Request a new code.' });
    expect((await svc.requestCurrentVerification(app, C)).ok).toBe(true);
    expect(await svc.confirmCurrentVerification(app, C, '000000')).toMatchObject({ ok: false });
    expect(await svc.confirmCurrentVerification(app, C, '123456')).toEqual({ ok: true, verified: true });
    const c: any = (await sql`select normalized_phone, phone_verified_at from customers where id = ${C}`.execute(db)).rows[0];
    expect(c.normalized_phone).toBe('+18565550125');
    expect(c.phone_verified_at).not.toBeNull();
    const active: any = (await sql`select status from customer_phones where customer_id = ${C} and status in ('active_verified','active_unverified')`.execute(db)).rows;
    expect(active).toEqual([{ status: 'active_verified' }]);
    expect(sent).toHaveLength(0);                                       // the "old" number is this number: nobody to warn
    expect(await svc.requestCurrentVerification(app, C)).toEqual({ ok: true, verified: true });   // already verified
    const ev: any[] = (await sql`select event_type from outbox_events where aggregate_id = ${C} and event_type = 'customer.phone_verified'`.execute(db)).rows;
    expect(ev).toHaveLength(1);
  });

  it('a customer with no number on file is told to add one', async () => {
    const C = await customer(null);
    expect(await service().svc.requestCurrentVerification(ctx('CUSTOMER', 'customer_app'), C)).toEqual({ ok: false, message: 'Add a phone number to your profile first.' });
  });
});

describe('a customer’s own change happens at their salon location', () => {
  it('the app session carries no branch; the code is sent and checked for the customer’s home branch (never a blank one)', async () => {
    const C = await customer('+18565550131');
    const seen: string[] = [];
    const otp = fakeOtp();
    const spy: VerificationPort = {
      async send(c, phone) { seen.push('send:' + c.branchId); return otp.send(c, phone); },
      async check(c, phone, code) { seen.push('check:' + c.branchId); return otp.check(c, phone, code); },
    };
    const svc = new CustomerPhoneUpdateService(new KyselyPhoneStore(db, new OutboxWriter()), spy, new KyselySyncPort(db));
    const app = { tenantId: T, branchId: null, userId: U, role: 'CUSTOMER' as const, source: 'customer_app' as const };
    const a = await svc.start(app, { customerId: C, newPhone: '+18565550132', reauth: 'ok' });
    const row: any = (await sql`select branch_id from customer_phone_update_sessions where id = ${a.sessionId}`.execute(db)).rows[0];
    expect(row.branch_id).toBe(B);
    await svc.sendCode(app, a.sessionId, '+18565550132', C);
    const v = await svc.verify(app, a.sessionId, '+18565550132', '123456', C);
    expect(seen).toEqual(['send:' + B, 'check:' + B]);
    expect(v.activated).toBe(true);
  });
  it('a session context with an EMPTY branch (what the real request context carries) is treated as no branch — found by the live proof', async () => {
    const C = await customer('+18565550133');
    const { svc, otp } = service();
    for (const branchId of ['', null]) {
      const app = { tenantId: T, branchId: branchId as any, userId: U, role: 'RECEPTION' as const, source: 'staff_pos' as const };
      const a = await svc.start(app, { customerId: C, newPhone: branchId === '' ? '+18565550134' : '+18565550135' });
      const row: any = (await sql`select branch_id from customer_phone_update_sessions where id = ${a.sessionId}`.execute(db)).rows[0];
      expect(row.branch_id).toBe(B);
      await svc.cancel(app, a.sessionId, C);
    }
    expect(otp.sent).toEqual([]);
  });
  it('the salon’s own settings apply when the context’s branch is empty (an empty branch errored into "no settings" → defaults)', async () => {
    const { KyselyPhoneSettingsStore } = await import('./customer-phone-settings.kysely');
    const T2 = '55555555-5555-4555-8555-555555555555';
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T2}, 'Two LLC', 'Two', 'two-salon', 'TWO001', 'ACTIVE') on conflict do nothing`.execute(db);
    await sql`insert into tenant_customer_phone_settings (tenant_id, require_manager_approval) values (${T2}, true)`.execute(db);
    expect((await new KyselyPhoneSettingsStore(db).get(T2, '' as any))?.requireManagerApproval).toBe(true);
    expect((await new KyselyPhoneSettingsStore(db).get(T2, null))?.requireManagerApproval).toBe(true);
  });
  it('status of a number on file from before the phone table (no customer_phones row): masked and readable, never empty — found by the live proof', async () => {
    const C = await customer('+18565550136', true);
    const { svc } = service();
    const st = await svc.status(ctx(), C);
    expect(st.phone?.masked).toContain('0136');
    expect(st.phone?.display).toBe('(856) 555-0136');
    const mine = await svc.status({ ...ctx('CUSTOMER', 'customer_app') }, C);
    expect(mine.phone?.display).toBeNull();
    expect(mine.phone?.masked).toContain('0136');
  });
  it('moving the sign-in number ends every session, and their refresh tokens die with them (migration 499 trigger)', async () => {
    const { KyselyAuthPort } = await import('./customer-identity-phone.kysely');
    const uid = (await sql<{ id: string }>`insert into users (tenant_id, first_name, last_name, full_name, email, status, role)
      values (${T}, 'Ref', 'Resh', 'Ref Resh', ${'rt-' + Date.now() + '@flow.test'}, 'active', 'CUSTOMER') returning id`.execute(db)).rows[0].id;
    const sid = (await sql<{ id: string }>`insert into sessions (user_id, status, expires_at) values (${uid}, 'active', now() + interval '1 day') returning id`.execute(db)).rows[0].id;
    await sql`insert into refresh_tokens (session_id, user_id, token_hash, expires_at) values (${sid}, ${uid}, 'h-' || ${uid}, now() + interval '30 days')`.execute(db);
    await new KyselyAuthPort(db).revokeAllSessions(uid);
    const sess: any = (await sql`select status from sessions where id = ${sid}`.execute(db)).rows[0];
    const rt: any = (await sql`select revoked_at from refresh_tokens where session_id = ${sid}`.execute(db)).rows[0];
    expect(sess.status).toBe('revoked');
    expect(rt.revoked_at).not.toBeNull();
  });
  it('a BRANCH policy applies when the request carries no branch: the customer’s home branch decides — found by the live proof', async () => {
    const T3 = '66666666-6666-4666-8666-666666666666', B3 = '77777777-7777-4777-8777-777777777777';
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T3}, 'Three LLC', 'Three', 'three-salon', 'THR001', 'ACTIVE') on conflict do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B3}, ${T3}, 'Uptown', 'active', 'UTC') on conflict do nothing`.execute(db);
    await sql`insert into tenant_customer_phone_settings (tenant_id, branch_id, require_manager_approval) values (${T3}, ${B3}, true)`.execute(db);
    const C = String((await sql<{ id: string }>`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display)
      values (${T3}, ${B3}, 'Up', 'Town', 'Up Town', '+18565550137', '+18565550137') returning id`.execute(db)).rows[0].id);
    const { svc } = service();
    const r = await svc.start({ tenantId: T3, branchId: null, userId: U, role: 'RECEPTION', source: 'staff_pos' }, { customerId: C, newPhone: '+18565550138' });
    expect(r.state).toBe('manager_review_required');
  });
});

describe('the code typed on the customer display', () => {
  it('only after the code went out; only for THIS customer; the right code activates, a wrong one does not', async () => {
    const C = await customer('+18565550151');
    const other = await customer('+18565550152');
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550153' });
    await expect(svc.requestOnDisplay(ctx(), s.sessionId, C)).rejects.toMatchObject({ code: 'invalid_state' });   // no code sent yet
    await svc.sendCode(ctx(), s.sessionId, '+18565550153', C);
    expect(await svc.displayPrompt(T, C)).toBeNull();                                   // not asked for yet
    await expect(svc.requestOnDisplay(ctx(), s.sessionId, other)).rejects.toBeInstanceOf(PhoneUpdateError);   // E15: not that customer's
    expect(await svc.requestOnDisplay(ctx(), s.sessionId, C)).toEqual({ ok: true });
    expect(await svc.displayPrompt(T, C)).toEqual({ maskedPhone: '••••0153' });
    expect(await svc.displayPrompt(T, other)).toBeNull();
    expect((await svc.verifyFromDisplay(T, B, other, '123456')).ok).toBe(false);       // another customer's display session
    const wrong = await svc.verifyFromDisplay(T, B, C, '000000');
    expect(wrong.ok).toBe(false);
    expect((await sql`select normalized_phone from customers where id = ${C}`.execute(db)).rows[0]).toMatchObject({ normalized_phone: '+18565550151' });
    const right = await svc.verifyFromDisplay(T, B, C, '12-34 56');                   // digits only, as typed
    expect(right.ok).toBe(true);
    expect((await sql`select normalized_phone, phone_verified_at from customers where id = ${C}`.execute(db)).rows[0]).toMatchObject({ normalized_phone: '+18565550153' });
    expect(await svc.displayPrompt(T, C)).toBeNull();                                   // the pad goes away
  });
  it('a request older than 15 minutes no longer puts the pad on the screen', async () => {
    const C = await customer('+18565550154');
    const { svc } = service();
    const s = await svc.start(ctx(), { customerId: C, newPhone: '+18565550155' });
    await svc.sendCode(ctx(), s.sessionId, '+18565550155', C);
    await svc.requestOnDisplay(ctx(), s.sessionId, C);
    await sql`update customer_phone_update_sessions set display_requested_at = now() - interval '16 minutes' where id = ${s.sessionId}`.execute(db);
    expect(await svc.displayPrompt(T, C)).toBeNull();
  });
});

