// booking-verification-center.pgtest — Booking Phone Verification Complete Build Guide (Oct 30 2026) on the REAL schema.
//   P0 holds: a lapsed-but-unswept hold no longer blocks the next customer; the DATABASE clock refuses converting a lapsed hold.
//   §9 special rules: deposit / high-value facts read server-side from the booked services feed the policy; group stays off.
//   §9 setting: the high-value line is validated, saved, versioned and audited.
//   §10–§14 center: KPIs (Unknown ≠ 0), itemized health, live monitor nearest-expiry-first, history search (name, phone,
//   last 4, verification id, booking id, technician), filters, date basis in the salon's zone, 10/20/50 paging, detail
//   timeline + audited access, resend refused for a number not on the customer's record; tenant isolation everywhere.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { normalizePhone, phoneKey, maskPhone } from '@aipowersalon/customers';
import { BookingHoldService, KyselyHoldRepository, HoldNotConvertibleError } from './booking-hold.kysely';
import { KyselyVerificationStore } from './booking-verification.kysely';
import { VerifiedBookingFlow } from './booking-verification-flow';
import { BookingVerificationSettingsService } from './booking-verification-settings.service';
import { KyselyVerificationSettingsStore } from './booking-verification-settings.kysely';
import { BookingVerificationCenter, reasonText, verificationFunnel, triageFailure, deliveryEvidence } from './booking-verification-center';

const P = 'b7430000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), TECH = id('c1'), CAT = id('c7'), SVC_LO = id('c8'), SVC_HI = id('c9'), U = id('e1');
const CUST = id('d1'), CUST2 = id('d2'), OTHER = id('d9');
const PHONE = '+16095550142', PHONE2 = '+16095550177';
const ctx = (t = T) => ({ tenantId: t, branchId: t === T ? B : B2, userId: U, role: 'OWNER', permissions: ['settings.view', 'pos.booking.create'] });
let db: any; let audits: any[] = []; let sends: any[] = [];
const q = async (s: any) => (await s.execute(db)).rows as any[];
const center = () => new BookingVerificationCenter(db, { record: async (a: any) => { audits.push(a); } } as any,
  async (c: any, phone: string) => { sends.push({ c, phone }); return { status: 'sent' }; });

async function session(o: { tenant?: string; branch?: string; customer?: string | null; phone?: string; status?: string; minutesLeft?: number; createdAgoMin?: number; hold?: string | null; reason?: string | null; channel?: string; failure?: string | null }) {
  const e164 = normalizePhone(o.phone ?? PHONE)!;
  const r = await q(sql`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, booking_hold_id, customer_id, phone_hash, phone_mask, channel, status, expires_at, created_at, updated_at, policy_reason, failure_reason, verified_at)
    values (${o.tenant ?? T}, ${o.branch ?? B}, gen_random_uuid(), ${o.hold ?? null}, ${o.customer === undefined ? CUST : o.customer}, ${phoneKey(e164)}, ${maskPhone(e164)}, ${o.channel ?? 'online'}, ${o.status ?? 'sent'},
      now() + make_interval(mins => ${o.minutesLeft ?? 5}), now() - make_interval(mins => ${o.createdAgoMin ?? 0}), now() - make_interval(mins => ${o.createdAgoMin ?? 0}), ${o.reason ?? null}, ${o.failure ?? null},
      ${o.status === 'verified' ? sql`now()` : null}) returning id`);
  return String(r[0].id);
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'A', 'Salon A', 'bvc-a', 'BVCA01', 'active'), (${T2}, 'B', 'Salon B', 'bvc-b', 'BVCB01', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T2}, 'Other', 'America/New_York')`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Lan', 'Pham', 'Lan Pham')`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values
    (${CUST}, ${T}, ${B}, 'Ava', 'Kim', 'Ava Kim', ${PHONE}, 'active'), (${CUST2}, ${T}, ${B}, 'Bo', 'Tran', 'Bo Tran', ${PHONE2}, 'active'), (${OTHER}, ${T2}, ${B2}, 'Ava', 'Kim', 'Ava Kim', ${PHONE}, 'active')`);
  await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
  await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values
    (${SVC_LO}, ${T}, ${B}, ${CAT}, 'Polish', 30, 2500), (${SVC_HI}, ${T}, ${B}, ${CAT}, 'Full Set Deluxe', 90, 18000)`);
}, 180_000);

describe('P0 — the 10-minute hold (guide §3, §7, §8)', () => {
  it('a hold that expired but the sweep has not reached yet no longer blocks the next customer for that technician and time', async () => {
    const svc = new BookingHoldService(new KyselyHoldRepository(db));
    const start = Date.parse('2026-12-01T15:00:00Z'), end = start + 3600_000;
    await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, ${TECH}, to_timestamp(${start / 1000}), to_timestamp(${end / 1000}), now() - interval '20 seconds', 'held', gen_random_uuid(), 'online')`);
    const held = await svc.acquire({ tenantId: T, branchId: B, technicianId: TECH, startsAt: start, endsAt: end, bookingSessionId: id('f1'), channel: 'online' });
    expect(held.holdId).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await q(sql`select status, release_reason from booking_holds where tenant_id = ${T} and technician_id = ${TECH} and start_time = to_timestamp(${start / 1000}) order by created_at`);
    expect(rows.map((r) => [r.status, r.release_reason])).toEqual([['expired', 'hold_expired'], ['held', null]]);
  });
  it('a LIVE hold still blocks (the clean-up only touches lapsed holds)', async () => {
    const svc = new BookingHoldService(new KyselyHoldRepository(db));
    const start = Date.parse('2026-12-01T15:00:00Z');
    await expect(svc.acquire({ tenantId: T, branchId: B, technicianId: TECH, startsAt: start, endsAt: start + 3600_000, bookingSessionId: id('f2'), channel: 'online' })).rejects.toThrow(/held|taken/);
  });
  it('the DATABASE clock refuses converting a hold that has lapsed, even when the app clock still thinks it is live', async () => {
    const svc = new BookingHoldService(new KyselyHoldRepository(db));
    const sess = id('f3');
    const h = await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, ${TECH}, '2026-12-02T15:00:00Z', '2026-12-02T16:00:00Z', now() - interval '1 second', 'held', ${sess}, 'online') returning id, expires_at`);
    const appNow = new Date(h[0].expires_at).getTime() - 30_000;   // an app clock 30 s behind the database
    const err = await svc.convert(T, String(h[0].id), sess, id('f9'), appNow).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(HoldNotConvertibleError);
    expect(err.reason).toBe('expired');
    expect((await q(sql`select converted_appointment_id from booking_holds where id = ${h[0].id}`))[0].converted_appointment_id).toBeNull();
  });
});

describe('special re-verification facts (guide §9)', () => {
  it('riskFacts reads price from the services, the deposit policy and the salon\'s high-value line — this tenant only', async () => {
    const store = new KyselyVerificationStore(db);
    expect(await store.riskFacts(T, B, [SVC_LO])).toEqual({ priceCents: 2500, depositRequired: false, highValueThresholdCents: null });
    await q(sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'booking-appointments', ${JSON.stringify({ depositRequired: true, depositPercent: 20 })}::jsonb)`);
    await q(sql`insert into booking_verification_settings (tenant_id, branch_id, enabled, high_value_threshold_cents, version) values (${T}, null, true, 15000, 1)`);
    expect(await store.riskFacts(T, B, [SVC_LO, SVC_HI])).toEqual({ priceCents: 20500, depositRequired: true, highValueThresholdCents: 15000 });
    expect((await store.riskFacts(T2, B2, [SVC_HI]))!.priceCents).toBe(0);   // another salon's service ids price at nothing
  });
  it('the verified-booking flow passes those facts to the policy (deposit + high value), group stays off', async () => {
    let seen: any = 'unset';
    const guard: any = { resolve: async (_c: any, i: any) => { seen = i.risk; return { decision: 'not_required', mustVerify: false, blocked: false, reason: 'x', message: '', versions: {} }; } };
    const flow = new VerifiedBookingFlow(guard, new KyselyVerificationStore(db));
    await flow.admit({ tenantId: T, branchId: B, channel: 'online' }, { phone: PHONE, slot: { technicianId: null, startsAt: 0, endsAt: 1, serviceIds: [SVC_HI] } });
    expect(seen).toEqual({ isGroupBooking: false, requiresDeposit: true, isHighValue: true, highRisk: false });
    await flow.admit({ tenantId: T, branchId: B, channel: 'online' }, { phone: PHONE });
    expect(seen).toBeNull();   // no services named → no risk facts (the ordinary policy still applies)
  });
  it('reasonText explains the rule that forced verification', () => {
    expect(reasonText('risk_deposit')).toMatch(/deposit/);
    expect(reasonText('risk_high_value')).toMatch(/high-value/);
    expect(reasonText(null)).toBeNull();
  });
});

describe('high-value setting (guide §9: admin-configurable and auditable)', () => {
  it('saves, clears and refuses out-of-range amounts; every save is versioned and audited', async () => {
    const recorded: any[] = [];
    const svc = new BookingVerificationSettingsService(new KyselyVerificationSettingsStore(db), { resolve: async () => ({ status: 'missing' }) } as any, { record: async (a: any) => { recorded.push(a); } } as any);
    const before = (await svc.get(T2, null)).version;
    const v = await svc.patch(U, T2, null, { highValueThresholdCents: 25000 });
    expect(v.highValueThresholdCents).toBe(25000); expect(v.version).toBe(before + 1);
    expect(recorded.at(-1).metadata).toMatchObject({ highValueThresholdCents: 25000, changed: ['highValueThresholdCents'] });
    await expect(svc.patch(U, T2, null, { highValueThresholdCents: 50 })).rejects.toThrow(/between \$1 and \$100,000/);
    await expect(svc.patch(U, T2, null, { highValueThresholdCents: 12.5 as any })).rejects.toThrow(/between/);
    expect((await svc.patch(U, T2, null, { highValueThresholdCents: null })).highValueThresholdCents).toBeNull();
  });
});

describe('Verification center (guide §10–§14)', () => {
  let open: string, verified: string, locked: string, providerErr: string, old: string, foreign: string, liveHold: string, sendFail: string;
  beforeAll(async () => {
    liveHold = String((await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel, service_ids_json)
      values (${T}, ${B}, ${TECH}, '2026-12-03T15:00:00Z', '2026-12-03T16:00:00Z', now() + interval '90 seconds', 'held', gen_random_uuid(), 'online', ${JSON.stringify([SVC_HI])}::jsonb) returning id`))[0].id);
    open = await session({ hold: liveHold, minutesLeft: 8, reason: 'risk_high_value' });
    verified = await session({ status: 'verified', customer: CUST2, phone: PHONE2, channel: 'customer_app' });
    locked = await session({ status: 'locked', failure: 'too_many_attempts', minutesLeft: -1 });
    providerErr = await session({ status: 'failed', failure: 'provider_error:30007', customer: null, phone: '+16095550199' });
    old = await session({ status: 'expired', minutesLeft: -60 * 24 * 40, createdAgoMin: 60 * 24 * 40 });
    foreign = await session({ tenant: T2, branch: B2, customer: OTHER });
    for (let i = 0; i < 22; i++) await session({ status: 'verified', customer: CUST2, phone: PHONE2, createdAgoMin: 60 + i });   // history depth for paging
    sendFail = await session({ status: 'sent', failure: 'provider_error', customer: CUST2, phone: PHONE2, minutesLeft: -1, createdAgoMin: 59 });   // the salon's sender refused the code
  });

  it('KPIs: pending, verified today, failed today, active holds, SMS health, success % with its denominator', async () => {
    const s = await center().summary(ctx());
    expect(s.cards.pending.value).toBe(1);
    expect(s.cards.activeHolds).toMatchObject({ value: 2, expiringSoon: 1 });   // + the P0 test's live hold (10 min left)
    expect(s.cards.verifiedToday.value).toBeGreaterThanOrEqual(23);
    expect(s.cards.failedToday.value).toBe(3);   // the lockout + two provider failures (the 40-day-old expiry is not today)
    expect(s.cards.successRate.denominator).toBe(27); expect(s.cards.successRate.numerator).toBe(23);   // the 40-day-old one is outside the 30 days
    expect(s.cards.smsHealth.state).toBe('needs_setup');   // no Twilio account in this fixture — never a green check
    const empty = await center().summary({ ...ctx(), tenantId: id('a9') });
    expect(empty.cards.successRate.value).toBeNull();   // Unknown, not 0 %
  });
  it('health: itemized, each with state, evidence and next action — no account means Needs Setup, never Ready', async () => {
    const h = await center().health(ctx(), { enabled: false, provider: { connected: false, validated: false, blockedReason: 'x' }, platform: { requiredByPlatform: false, blockedByPlatform: false, emergencyDisabled: false, moduleDisabled: false } });
    expect(h.items.map((i) => i.key)).toEqual(['twilio_identity', 'verify_service', 'sender', 'policy', 'recent_errors', 'integration']);
    expect(h.items.find((i) => i.key === 'twilio_identity')!.state).toBe('needs_setup');
    expect(h.items.find((i) => i.key === 'recent_errors')).toMatchObject({ state: 'degraded' });
    expect(h.items.every((i) => i.evidence && i.checkedAt)).toBe(true);
    expect(h.overall).toBe('needs_setup');
    await q(sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, last_validated_at) values (${T}, 'twilio', 'ACtest', 'enc', '+16095550100', 'configured', now())`);
    const h2 = await center().health(ctx(), null);
    expect(h2.items.find((i) => i.key === 'twilio_identity')!.state).toBe('ready');
    expect(h2.items.find((i) => i.key === 'sender')!.state).toBe('ready');
    expect(h2.items.find((i) => i.key === 'policy')!.state).toBe('unknown');
    expect(JSON.stringify(h2)).not.toMatch(/ACtest|enc"/);   // no SID, no token
  });
  it('live monitor: nearest expiry first, code and hold status separate, never a code', async () => {
    const l = await center().live(ctx(), {});
    expect(l.order).toBe('nearest_expiry_first');
    expect(l.items[0].id).toBe(open);                       // its hold lapses in 90 s — the most urgent
    expect(l.items[0].hold).toMatchObject({ status: 'expiring_soon', technicianName: 'Lan Pham' });
    expect(l.items[0].codeState).toBe('sent');
    expect(l.items.map((i) => i.id)).not.toContain(foreign);
    expect(JSON.stringify(l)).not.toMatch(/code_hash|phone_hash/);
  });
  it('history: newest first, exact total, 10/20/50 pages, search by name / phone / last 4 / verification id / technician', async () => {
    const c = center();
    const p1 = await c.history(ctx(), { pageSize: 10 });
    expect(p1.totalItems).toBe(28); expect(p1.totalPages).toBe(3); expect(p1.items).toHaveLength(10);
    const p3 = await c.history(ctx(), { pageSize: 10, page: 3 });
    expect(p3.items).toHaveLength(8); expect(p3.items.at(-1)!.id).toBe(old);   // the oldest is last
    expect((await c.history(ctx(), { pageSize: 20 })).items).toHaveLength(20);
    expect((await c.history(ctx(), { pageSize: 7 })).pageSize).toBe(10);       // only 10 / 20 / 50
    expect((await c.history(ctx(), { q: 'ava kim' })).totalItems).toBe(3);   // open, locked, the 40-day-old one
    expect((await c.history(ctx(), { q: '(609) 555-0142' })).totalItems).toBe(3);
    expect((await c.history(ctx(), { q: '0199' })).items.map((i) => i.id)).toEqual([providerErr]);
    expect((await c.history(ctx(), { q: verified })).items.map((i) => i.id)).toEqual([verified]);
    expect((await c.history(ctx(), { q: 'Lan Pham' })).items.map((i) => i.id)).toEqual([open]);
    expect((await c.history(ctx(), { q: 'ava kim' })).items.map((i) => i.id)).not.toContain(foreign);   // another salon's Ava Kim
  });
  it('filters: status (incl. provider error), channel, date basis in the salon\'s zone; bad filters refused', async () => {
    const c = center();
    expect((await c.history(ctx(), { status: 'provider_error' })).items.map((i) => i.id)).toEqual([providerErr, sendFail]);   // newest first; a refused send counts too
    expect((await c.history(ctx(), { status: 'failed' })).items.map((i) => i.id)).toEqual([locked]);
    expect((await c.history(ctx(), { status: 'expired' })).items.map((i) => i.id)).toEqual([old]);
    expect((await c.history(ctx(), { channel: 'customer_app' })).totalItems).toBe(1);
    expect((await c.history(ctx(), { status: 'pending' })).items.map((i) => i.id)).toEqual([open]);   // the refused send is not 'pending'
    expect((await c.history(ctx(), { preset: 'today' })).totalItems).toBe(27);
    const tz: any = (await q(sql`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`))[0].d;
    expect((await c.history(ctx(), { preset: 'custom', from: tz, to: tz })).totalItems).toBe(27);
    expect((await c.history(ctx(), { preset: 'custom', from: tz, to: tz, basis: 'hold_created' })).items.map((i) => i.id)).toEqual([open]);
    await expect(c.history(ctx(), { status: 'nope' })).rejects.toThrow(/Unknown status/);
    await expect(c.history(ctx(), { preset: 'custom', from: '2026-12-02', to: '2026-12-01' })).rejects.toThrow(/on or before/);
    const far = await c.history(ctx(), { page: 999, pageSize: 10 } as any);   // Nov 3 audit: a page past the end shows the last page, not an empty one
    expect(far.page).toBe(far.totalPages); if (far.totalItems) expect(far.items.length).toBeGreaterThan(0);
  });
  it('detail: the rule that forced verification, the timeline, masked provider ref; opening it is audited; another salon gets 404', async () => {
    audits = [];
    const d = await center().detail(ctx(), open);
    expect(d.policy.why).toMatch(/high-value/);
    expect(d.services).toEqual(['Full Set Deluxe']);
    expect(d.timeline.map((t) => t.event)).toContain('Verification requested');
    expect(d.canResend).toBe(true);
    expect(audits).toEqual([expect.objectContaining({ action: 'verification_record_viewed', metadata: { verificationId: open } })]);
    await expect(center().detail(ctx(), foreign)).rejects.toThrow(/could not be found/);
    await expect(center().detail(ctx(T2), open)).rejects.toThrow(/could not be found/);
  });
  it('resend: only an open code, only to the number on the customer\'s record — never redirected; audited', async () => {
    sends = []; audits = [];
    expect(await center().resend(ctx(), open)).toEqual({ status: 'sent', message: null });
    expect(sends).toEqual([{ c: expect.objectContaining({ tenantId: T, branchId: B, channel: 'online', customerId: CUST }), phone: PHONE }]);
    expect(audits[0]).toMatchObject({ action: 'verification_code_resent_by_staff' });
    await expect(center().resend(ctx(), locked)).rejects.toThrow(/no longer open/);
    await expect(center().resend(ctx(), providerErr)).rejects.toThrow(/no longer open/);
    const moved = await session({ customer: CUST, phone: PHONE2 });   // the session's number is NOT the customer's record
    await expect(center().resend(ctx(), moved)).rejects.toThrow(/not the number this code was requested for/);
    expect((await center().detail(ctx(), moved)).canResend).toBe(false);   // Nov 3 audit: the overlay no longer offers a resend that would be refused
    await expect(center().resend(ctx(T2), open)).rejects.toThrow(/could not be found/);
    expect(sends).toHaveLength(1);
  });
});

// Extras · Booking Phone Verification 09 — the funnel counts only recorded evidence, in its own salon
describe('Verification Funnel Scorecard', () => {
  const T3 = id('a3'), B3 = id('b3'), TECH3 = id('c3'), C3 = id('d3');
  const c3 = { tenantId: T3, branchId: B3, userId: U, role: 'OWNER', permissions: ['settings.view'] };
  it('requested → sent → verified → hold converted → booking confirmed, with conversions; overrides apart; old rows outside', async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T3}, 'C', 'Salon C', 'bvc-c', 'BVCC01', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B3}, ${T3}, 'Third', 'America/New_York')`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH3}, ${T3}, ${B3}, 'Mai', 'Le', 'Mai Le')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${C3}, ${T3}, ${B3}, 'Cy', 'Do', 'Cy Do', '+16095550199', 'active')`);
    const appt = async (status: string, day: number) => String((await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status)
      values (${T3}, ${B3}, ${TECH3}, ${C3}, 'Cy Do', ${`2026-12-${String(day).padStart(2, '0')}`}::date, '10:00', '11:00', ${status}) returning id`))[0].id);
    const hold = async (day: number, apptId: string | null) => String((await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel, converted_appointment_id)
      values (${T3}, ${B3}, ${TECH3}, ${`2026-12-${String(day).padStart(2, '0')}T15:00:00Z`}::timestamptz, ${`2026-12-${String(day).padStart(2, '0')}T16:00:00Z`}::timestamptz, now() + interval '5 minutes', ${apptId ? 'converted' : 'held'}, gen_random_uuid(), 'online', ${apptId}) returning id`))[0].id);
    const sent = async (sid: string) => q(sql`update booking_verification_sessions set last_sent_at = now() where id = ${sid}::uuid`);
    const s1 = await session({ tenant: T3, branch: B3, customer: C3, status: 'sent' }); await sent(s1);                 // sent, never verified
    await session({ tenant: T3, branch: B3, customer: C3, status: 'pending' });                                         // requested, nothing sent
    const s3 = await session({ tenant: T3, branch: B3, customer: C3, status: 'verified', hold: await hold(10, await appt('confirmed', 10)) }); await sent(s3);
    const s4 = await session({ tenant: T3, branch: B3, customer: C3, status: 'verified', hold: await hold(11, await appt('cancelled', 11)) }); await sent(s4);
    const s5 = await session({ tenant: T3, branch: B3, customer: C3, status: 'verified', hold: await hold(12, null) }); await sent(s5);
    const s6 = await session({ tenant: T3, branch: B3, customer: C3, status: 'pending' });
    await q(sql`update booking_verification_sessions set override_at = now() where id = ${s6}::uuid`);
    const old = await session({ tenant: T3, branch: B3, customer: C3, status: 'verified', createdAgoMin: 40 * 24 * 60 }); await sent(old);
    const f = (await center().summary(c3)).funnel;
    expect(f.steps.map((x) => [x.key, x.count])).toEqual([['requested', 6], ['sent', 4], ['verified', 3], ['holdConverted', 2], ['confirmed', 1]]);
    expect(f.steps.map((x) => x.conversionPercent)).toEqual([null, 66.7, 75, 66.7, 50]);
    expect(f.overrides).toBe(1);
    expect(f.steps.every((x) => x.definition.length > 10)).toBe(true);
    // another salon's funnel is its own (T3 rows never counted for T2)
    expect((await center().summary(ctx(T2))).funnel.steps.find((x) => x.key === 'confirmed')!.count).toBe(0);
  });
  it('a step after a zero step is unknown (null), never 0 %', () => {
    const f = verificationFunnel({ requested: 0, sent: 0, verified: 0, holdConverted: 0, confirmed: 0, overrides: 0 });
    expect(f.steps.map((x) => x.conversionPercent)).toEqual([null, null, null, null, null]);
  });
});

// Extras · Booking Phone Verification 12 — failures grouped by what to fix
describe('Provider Failure Triage', () => {
  const T4 = id('a4'), B4 = id('b4');
  const c4 = { tenantId: T4, branchId: B4, userId: U, role: 'OWNER', permissions: ['settings.view'] };
  it('groups the last 7 days of provider failures by permission / service / sender / rate limit / unavailable / wrong phone; wrong guesses and old rows stay out', async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T4}, 'D', 'Salon D', 'bvc-d', 'BVCD01', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B4}, ${T4}, 'Fourth', 'America/New_York')`);
    const f = (failure: string, status = 'sent', createdAgoMin = 30) => session({ tenant: T4, branch: B4, customer: null, status, failure, createdAgoMin });
    await f('provider_error:20003'); await f('provider_error:20003', 'failed'); await f('rate_limited:http_429'); await f('provider_error:21211');
    await f('provider_error:network'); await f('not_configured'); await f('provider_error');                 // no code → other
    await f('incorrect', 'failed');                                                                          // a customer's wrong guess
    await f('provider_error:20003', 'sent', 10 * 24 * 60);                                                   // 10 days ago
    const t = (await center().summary(c4)).providerFailures;
    expect(t.windowDays).toBe(7); expect(t.total).toBe(7);
    expect(t.groups.map((g) => [g.category, g.count])).toEqual([['permission', 2], ['service', 1], ['rate_limit', 1], ['unavailable', 1], ['wrong_phone', 1], ['other', 1]]);
    expect(t.groups[0].codes).toEqual(['20003']);
    expect(JSON.stringify(t)).not.toMatch(/Authenticate|AC[0-9a-f]/);
  });
  it('triageFailure never guesses: unknown codes are "other"', () => {
    expect(triageFailure('provider_error:30007')).toBe('sender');
    expect(triageFailure('provider_error:99999')).toBe('other');
    expect(triageFailure('invalid_number')).toBe('wrong_phone');
    expect(triageFailure(null)).toBe('other');
  });
});

// Extras · Booking Phone Verification 07 — sender readiness, send attempts, delivery events and successful checks kept apart
describe('Verified SMS Delivery Evidence', () => {
  const T5 = id('a5'), B5 = id('b5');
  const c5 = { tenantId: T5, branchId: B5, userId: U, role: 'OWNER', permissions: ['settings.view'] };
  it('a send is never a delivery: receipts, provider failures and "no report" are counted separately; overrides are not checks', async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T5}, 'E', 'Salon E', 'bvc-e', 'BVCE01', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B5}, ${T5}, 'Fifth', 'America/New_York')`);
    const mk = async (o: { status?: string; failure?: string | null; sent?: boolean; delivered?: boolean; resends?: number; override?: boolean; agoMin?: number }) => {
      const sid = await session({ tenant: T5, branch: B5, customer: null, status: o.status ?? 'sent', failure: o.failure ?? null, createdAgoMin: o.agoMin ?? 5 });
      await q(sql`update booking_verification_sessions set last_sent_at = ${o.sent === false ? null : sql`now()`}, delivered_at = ${o.delivered ? sql`now()` : null},
        resend_count = ${o.resends ?? 0}, override_at = ${o.override ? sql`now()` : null} where id = ${sid}::uuid`);
    };
    await mk({ delivered: true, status: 'verified' });             // delivered + checked
    await mk({ delivered: true, resends: 2 });                      // delivered, 3 attempts, not checked
    await mk({});                                                   // sent, no receipt → no report
    await mk({ failure: 'provider_error:30007' });                  // provider failed
    await mk({ sent: false, status: 'pending' });                   // requested, never sent
    await mk({ sent: false, status: 'verified', override: true });  // staff override — not a check
    await mk({ delivered: true, status: 'verified', agoMin: 40 * 24 * 60 });   // outside 30 days
    const e = (await center().summary(c5)).deliveryEvidence;
    expect(e.windowDays).toBe(30);
    expect(e.sender.state).toBe('needs_setup');                     // no Twilio account in this salon — readiness is its own stage
    expect(e.sends).toMatchObject({ sessions: 4, attempts: 6 });
    expect(e.delivery).toMatchObject({ delivered: 2, providerFailed: 1, noReport: 1, deliveredPercent: 50 });
    expect(e.delivery.lastDeliveredAt).toMatch(/^\d{4}-/);
    expect(e.checks).toMatchObject({ verified: 1, percentOfSent: 25 });
    expect((await center().summary(ctx(T2))).deliveryEvidence.delivery.delivered).toBe(0);   // another salon sees none of it
  });
  it('rates are unknown (null) with nothing sent, never 0 %', () => {
    const e = deliveryEvidence('ready', { sessionsSent: 0, sendAttempts: 0, delivered: 0, providerFailed: 0, noDeliveryReport: 0, successfulChecks: 0, lastDeliveredAt: null });
    expect(e.delivery.deliveredPercent).toBeNull(); expect(e.checks.percentOfSent).toBeNull();
    expect(e.sender.definition).toMatch(/not proof/);
  });
});

describe('extras 10 — Lost-Booking Recovery (fresh times after an expired hold; never auto-confirms)', () => {
  it('an expired, unconverted hold offers POS Booking\'s open starts for the same services, the held technician first; nothing is written', async () => {
    const h = await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, released_at, release_reason, booking_session_id, channel, service_ids_json)
      values (${T}, ${B}, ${TECH}, now() + interval '3 days', now() + interval '3 days 1 hour', now() - interval '5 minutes', 'expired', now() - interval '4 minutes', 'hold_expired', gen_random_uuid(), 'online', ${JSON.stringify([SVC_LO])}::jsonb) returning id`);
    const lost = await session({ hold: String(h[0].id), status: 'expired', minutesLeft: -5 });
    const asked: any[] = [];
    const c = center();
    c.availability = async (cx, qq) => { asked.push({ cx, qq }); return [{ technicianId: id('c2'), name: 'Mai', slots: ['09:00', '10:30'] }, { technicianId: TECH, name: 'Lan Pham', slots: ['11:00'] }]; };
    const holdsBefore = await q(sql`select count(*)::int n from booking_holds where tenant_id = ${T}`);
    const d: any = await c.detail({ ...ctx(), permissions: ['settings.view', 'pos.booking.view'] }, lost);
    expect(d.recovery).toMatchObject({ state: 'offered', noteCode: null, totalOpen: 3 });
    expect(asked[0].qq.serviceIds).toEqual([SVC_LO]);
    expect(asked[0].cx.branchId).toBe(B);
    expect(d.recovery.date).toBe(asked[0].qq.date);
    expect(d.recovery.alternatives.map((x: any) => [x.technicianName, x.start, x.preferred])).toEqual([['Lan Pham', '11:00', true], ['Mai', '09:00', false], ['Mai', '10:30', false]]);
    expect(d.recovery.safety).toMatch(/never confirmed/);
    expect(await q(sql`select count(*)::int n from booking_holds where tenant_id = ${T}`)).toEqual(holdsBefore);   // nothing held or booked
    // a role that cannot view the booking calendar is told so (not an empty list that reads as fully booked)
    const d2: any = await c.detail(ctx(), lost);
    expect(d2.recovery).toMatchObject({ state: 'not_permitted', noteCode: 'not_permitted', alternatives: [] });
    c.availability = async () => [];
    expect((await c.detail({ ...ctx(), permissions: ['settings.view', 'pos.booking.view'] }, lost) as any).recovery).toMatchObject({ state: 'offered', noteCode: 'no_staff', totalOpen: 0 });
    // no engine wired → says so
    expect((await center().detail({ ...ctx(), permissions: ['settings.view', 'pos.booking.view'] }, lost) as any).recovery.state).toBe('not_connected');
  });
  it('a live or converted hold, and a record without a hold, get no recovery block', async () => {
    const h = await q(sql`insert into booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
      values (${T}, ${B}, ${TECH}, now() + interval '4 days', now() + interval '4 days 1 hour', now() + interval '8 minutes', 'held', gen_random_uuid(), 'online') returning id`);
    const live = await session({ hold: String(h[0].id) });
    const c = center(); c.availability = async () => { throw new Error('must not be called'); };
    expect((await c.detail({ ...ctx(), permissions: ['settings.view', 'pos.booking.view'] }, live) as any).recovery).toBeNull();
    const none = await session({ hold: null, status: 'expired', minutesLeft: -1 });
    expect((await c.detail({ ...ctx(), permissions: ['settings.view', 'pos.booking.view'] }, none) as any).recovery).toBeNull();
  });
});
