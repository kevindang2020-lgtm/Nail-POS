// phone-center.pgtest — Phone Number Management Complete Build Guide: the center's read model over the REAL schema, driven by the
// rows shaped exactly as CustomerPhoneUpdateService writes them (customer_phones + customer_phone_update_sessions). The service's own
// start → send → verify → activate path is proven by customer-phone-flow.pgtest (it needs the Kysely query builder: CI).
// Proves: the trusted number stays effective while a change is pending / failed / expired; history is newest first with
// server-side search beyond page 1; Pending & Recovery is soonest-deadline first; tenant-local custom ranges; the sync monitor
// reads the durable job; a manual exception is never SMS verified; shared numbers are counted, never merged; sender readiness
// never exposes a secret and never calls "connected" verified; the old-number notice is submitted vs delivered; tenant isolation.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { phoneKey, maskPhone } from '@aipowersalon/customers';
import { PHONE_JOB } from './customer-phone.kysely';
import { PhoneCenter, groupOf, syncStateOf, type PcContext } from './phone-center';

const T = 'a7420000-0000-4000-8000-000000000001';
const T2 = 'a7420000-0000-4000-8000-000000000002';
const B = 'a7420000-0000-4000-8000-0000000000b1';
const B2 = 'a7420000-0000-4000-8000-0000000000b2';
const U = 'a7420000-0000-4000-8000-0000000000e1';
let db: any; let center: PhoneCenter; let seq = 0;
const ALL = ['pos.customers.view', 'pos.customers.edit', 'pos.customers.phone.approve', 'pos.customers.phone.resolve', 'pos.customers.phone.retry_sync', 'pos.customers.phone.manual_confirm'];
const pc = (perms = ALL, tenantId = T): PcContext => ({ tenantId, branchId: tenantId === T ? B : B2, userId: U, role: 'OWNER', permissions: perms });
type Seed = { state?: string; expiresInMin?: number | null; createdMinAgo?: number; provider?: string | null; tenantId?: string; source?: string };
const PROVEN = ['phone_verified', 'phone_activated', 'synchronization_failed', 'customer_records_synchronized'];
/** one change request exactly as CustomerPhoneUpdateService leaves it: the proposed number is its own customer_phones row
 *  (pending until proven; on proof it becomes active and the old row 'replaced', and customers.normalized_phone moves). */
async function request(customerId: string, newPhone: string, o: Seed = {}): Promise<string> {
  const t = o.tenantId ?? T; const state = o.state ?? 'pending_phone_saved'; const proven = PROVEN.includes(state);
  const old: any = (await sql`select normalized_phone from customers where id = ${customerId}`.execute(db)).rows[0];
  let oldId: string | null = null;
  if (old?.normalized_phone) oldId = String((await sql<any>`insert into customer_phones (tenant_id, customer_id, normalized_phone, phone_mask, phone_hash, status, verification_provider, verified_at, update_source)
    values (${t}, ${customerId}, ${old.normalized_phone}, ${maskPhone(old.normalized_phone)}, ${phoneKey(old.normalized_phone)}, ${proven ? 'replaced' : 'active_verified'}, 'twilio_verify', now() - interval '90 days', 'import') returning id`.execute(db)).rows[0].id);
  const newId = String((await sql<any>`insert into customer_phones (tenant_id, customer_id, normalized_phone, phone_mask, phone_hash, status, verification_provider, verified_at, update_source)
    values (${t}, ${customerId}, ${newPhone}, ${maskPhone(newPhone)}, ${phoneKey(newPhone)}, ${proven ? (o.provider === 'staff_override' ? 'active_unverified' : 'active_verified') : 'pending_verification'},
            ${proven ? (o.provider ?? 'twilio_verify') : null}, ${proven && o.provider !== 'staff_override' ? sql`now()` : null}, ${o.source ?? 'staff_pos'}) returning id`.execute(db)).rows[0].id);
  if (proven) await sql`update customers set normalized_phone = ${newPhone} where id = ${customerId}`.execute(db);
  const done = state === 'customer_records_synchronized' || state === 'update_canceled';
  return String((await sql<any>`insert into customer_phone_update_sessions (tenant_id, branch_id, customer_id, proposed_phone, proposed_phone_hash, proposed_phone_mask, previous_phone_id, new_phone_id,
      state, update_source, requested_by_user_id, requested_by_role, expires_at, created_at, updated_at, completed_at)
    values (${t}, ${t === T ? B : B2}, ${customerId}, ${newPhone}, ${phoneKey(newPhone)}, ${maskPhone(newPhone)}, ${oldId}, ${newId}, ${state}, ${o.source ?? 'staff_pos'}, ${t === T ? U : null}, 'RECEPTION',
      ${o.expiresInMin === null ? null : sql`now() + make_interval(mins => ${o.expiresInMin ?? 30})`}, now() - make_interval(mins => ${o.createdMinAgo ?? 0}), now(), ${done ? sql`now()` : null}) returning id`.execute(db)).rows[0].id);
}
async function customer(phone: string | null, tenantId = T, name?: string): Promise<string> {
  seq++;
  const full = name ?? `Phone Person${seq}`;
  const [first, ...rest] = full.split(' ');
  return String((await sql<{ id: string }>`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, phone_verified_at)
    values (${tenantId}, ${tenantId === T ? B : B2}, ${first}, ${rest.join(' ') || 'X'}, ${full}, ${phone}, ${phone}, now()) returning id`.execute(db)).rows[0].id);
}
const num = (i: number) => '+1856555' + String(1000 + i).slice(-4);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  center = new PhoneCenter(db);
  for (const [t, b, slug] of [[T, B, 'pc-a'], [T2, B2, 'pc-b']]) {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase().replace('-', '') + '01'}, 'active')`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${b}, ${t}, 'Main', 'America/New_York')`.execute(db);
  }
  await sql`insert into users (id, tenant_id, full_name, email, status, role) values (${U}, ${T}, 'Front Desk Fiona', 'fiona@pc.test', 'active', 'OWNER')`.execute(db);
}, 180_000);

describe('pure rules', () => {
  it('queue status and sync state', () => {
    expect(groupOf('verification_sent', new Date(Date.now() + 60_000), null)).toBe('code_sent');
    expect(groupOf('verification_sent', new Date(Date.now() - 1000), null)).toBe('expired');
    expect(groupOf('manager_review_required', null, null)).toBe('manager_review');
    expect(groupOf('synchronization_failed', null, null)).toBe('sync_attention');
    expect(syncStateOf('pending_phone_saved', null)).toBe('not_needed');
    expect(syncStateOf('synchronization_failed', { status: 'queued' })).toBe('retry_scheduled');
    expect(syncStateOf('synchronization_failed', { status: 'dead' })).toBe('failed');
    expect(syncStateOf('customer_records_synchronized', null)).toBe('synced');
  });
});

describe('the trusted number stays effective until the new one is proven', () => {
  let C = ''; let req = '';
  it('a pending change is listed, counted, and the overlay says the current phone remains active', async () => {
    C = await customer(num(1), T, 'Vishaal Kumar');
    req = await request(C, num(2));
    const cur: any = (await sql`select normalized_phone from customers where id = ${C}`.execute(db)).rows[0];
    expect(cur.normalized_phone).toBe(num(1));
    const sum = await center.summary(pc());
    expect(sum.kpis.pending.value).toBe(1);
    const d: any = await center.detail(pc(), req);
    expect(d.trustedStillActive).toBe(true);
    expect(d.message).toBe('The current verified phone remains active until the new phone is verified.');
    expect(d.newPhoneMasked).toContain('1002');
    expect(d.actions.cancel).toBe(true);
    expect(d.actions.manualException).toBe(false);          // OFF by default (screenshot setting 5)
    expect(JSON.stringify(d)).not.toMatch(/123456|code_hash/);
    const q: any = await center.pending(pc(), {});
    expect(q.items.map((x: any) => x.id)).toContain(req);
  });
  it('a wrong code keeps the old number and the request retryable; the right code activates it once', async () => {
    await sql`update customer_phone_update_sessions set state = 'verification_failed' where id = ${req}`.execute(db);   // what a wrong code leaves
    expect(((await sql`select normalized_phone from customers where id = ${C}`.execute(db)).rows[0] as any).normalized_phone).toBe(num(1));
    expect((await center.detail(pc(), req) as any).status).toBe('retry_allowed');
    // the right code: the service activates atomically — new row active, old row replaced, customer row moves, request synchronised
    await sql`update customer_phones set status = 'replaced' where id = (select previous_phone_id from customer_phone_update_sessions where id = ${req})`.execute(db);
    await sql`update customer_phones set status = 'active_verified', verification_provider = 'twilio_verify', verified_at = now(), effective_from = now() where id = (select new_phone_id from customer_phone_update_sessions where id = ${req})`.execute(db);
    await sql`update customers set normalized_phone = ${num(2)} where id = ${C}`.execute(db);
    await sql`update customer_phone_update_sessions set state = 'customer_records_synchronized', completed_at = now(), updated_at = now() where id = ${req}`.execute(db);
    const d: any = await center.detail(pc(), req);
    expect(d.status).toBe('completed');
    expect(d.verificationMethod).toBe('sms_verified');
    expect(d.trustedStillActive).toBe(false);
    expect(d.sync.state).toBe('synced');
    const sum = await center.summary(pc());
    expect(sum.kpis.today.value).toBeGreaterThanOrEqual(1);
    expect(sum.kpis.verified.value).toBeGreaterThanOrEqual(1);
    expect(sum.kpis.pending.value).toBe(0);
  });
  it('an expired request reads Expired with the original phone intact', async () => {
    const C2 = await customer(num(3));
    const st = { sessionId: await request(C2, num(4), { state: 'verification_sent', expiresInMin: -1 }) };
    const d: any = await center.detail(pc(), st.sessionId);
    expect(d.status).toBe('expired');
    expect(d.actions.sendCode).toBe(false);
    expect(((await sql`select normalized_phone from customers where id = ${C2}`.execute(db)).rows[0] as any).normalized_phone).toBe(num(3));
    const h: any = await center.history(pc(), { group: 'expired' });
    expect(h.items.map((x: any) => x.id)).toContain(st.sessionId);
  });
});

describe('search, order and pages', () => {
  const made: string[] = [];
  it('history is newest first; page 2 exists; search finds a record that is not on page 1', async () => {
    for (let i = 10; i < 22; i++) {
      const c = await customer(num(i), T, i === 10 ? 'Marisol Ortega' : undefined);
      made.push(await request(c, num(100 + i), { createdMinAgo: 60 - i }));
    }
    const p1: any = await center.history(pc(), { pageSize: 10, page: 1 });
    expect(p1.totalItems).toBeGreaterThanOrEqual(12);
    expect(p1.totalPages).toBeGreaterThanOrEqual(2);
    const times = p1.items.map((x: any) => new Date(x.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(p1.items.map((x: any) => x.id)).not.toContain(made[0]);          // the oldest is beyond page 1 …
    const byName: any = await center.history(pc(), { q: 'marisol' });
    expect(byName.items.map((x: any) => x.id)).toEqual([made[0]]);          // … and search still finds it
    const byDigits: any = await center.history(pc(), { q: num(110).slice(-4) });
    expect(byDigits.items.map((x: any) => x.id)).toContain(made[0]);
    const byId: any = await center.history(pc(), { q: made[0] });
    expect(byId.totalItems).toBe(1);
    const byStaff: any = await center.history(pc(), { q: 'fiona' });
    expect(byStaff.totalItems).toBeGreaterThanOrEqual(12);
  });
  it('Pending & Recovery puts the soonest deadline first, not the newest', async () => {
    await sql`update customer_phone_update_sessions set expires_at = now() + interval '2 minutes' where id = ${made[5]}`.execute(db);
    const q: any = await center.pending(pc(), { pageSize: 50 });
    expect(q.order).toBe('soonest_expiry_then_oldest');   // still-savable requests first; already-expired after; sync work last
    expect(q.items[0].id).toBe(made[5]);
  });
  it('tenant-local custom range: inclusive end day, nothing outside it; a reversed range is refused', async () => {
    await sql`update customer_phone_update_sessions set created_at = now() - interval '3 days' where id = ${made[1]}`.execute(db);
    const today: string = ((await sql`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`.execute(db)).rows[0] as any).d;
    const only: any = await center.history(pc(), { preset: 'custom', from: today, to: today, pageSize: 50 });
    expect(only.items.map((x: any) => x.id)).not.toContain(made[1]);
    const wide: any = await center.history(pc(), { preset: 'month', pageSize: 50 });
    expect(wide.timezone).toBe('America/New_York');
    await expect(center.history(pc(), { preset: 'custom', from: '2026-10-31', to: '2026-10-01' })).rejects.toMatchObject({ apiCode: 'INVALID_FILTER' });
    await expect(center.history(pc(), { basis: 'whenever' })).rejects.toMatchObject({ apiCode: 'INVALID_FILTER' });
  });
});

describe('sync monitor, manual exception, shared numbers, notices, readiness', () => {
  it('a failed synchronisation shows its durable job: Retry Scheduled, then Failed when the job gave up', async () => {
    const c = await customer(num(40));
    const st = { sessionId: await request(c, num(41), { state: 'synchronization_failed' }) };
    await sql`insert into jobs (job_class, job_type, tenant_id, payload, idempotency_key, status) values ('standard', ${PHONE_JOB.sync}, ${T}, '{}'::jsonb, ${'sync:' + st.sessionId}, 'queued')`.execute(db);
    let m: any = await center.syncIssues(pc(), {});
    let row = m.items.find((x: any) => x.id === st.sessionId);
    expect(row.sync.state).toBe('retry_scheduled');
    expect(row.canRetry).toBe(true);
    expect((await center.syncIssues(pc(['pos.customers.view']), {}) as any).items.find((x: any) => x.id === st.sessionId).canRetry).toBe(false);
    await sql`update jobs set status = 'dead', attempts = 8, last_error = 'identity service timeout' where idempotency_key = ${'sync:' + st.sessionId}`.execute(db);
    m = await center.syncIssues(pc(), { sync: 'failed' });
    row = m.items.find((x: any) => x.id === st.sessionId);
    expect(row.sync.state).toBe('failed');
    expect(row.sync.lastError).toContain('timeout');
    const h: any = await center.health(pc());
    expect(h.items.find((i: any) => i.key === 'sync').state).toBe('attention_required');
  });
  it('a manager\'s manual exception is labelled as such — never SMS verified', async () => {
    const c = await customer(num(50));
    const st = { sessionId: await request(c, num(51), { state: 'customer_records_synchronized', provider: 'staff_override' }) };
    const d: any = await center.detail(pc(), st.sessionId);
    expect(d.verificationMethod).toBe('manual_exception');
    expect(d.message).toContain('not SMS verified');
    const manual: any = await center.history(pc(), { method: 'manual' });
    expect(manual.items.map((x: any) => x.id)).toContain(st.sessionId);
    const sms: any = await center.history(pc(), { method: 'sms' });
    expect(sms.items.map((x: any) => x.id)).not.toContain(st.sessionId);
  });
  it('a shared family number is counted and filterable, and the two customers stay separate', async () => {
    const before = (await center.summary(pc())).kpis.shared.value;
    const mom = await customer('+18565559900', T, 'Lan Tran');
    const kid = await customer('+18565559900', T, 'Mai Tran');
    expect((await center.summary(pc())).kpis.shared.value).toBe(before + 1);
    const found: any = await center.customers(pc(), { q: 'tran' });
    expect(found.items.map((x: any) => x.customerId).sort()).toEqual([mom, kid].sort());
    expect(found.items.every((x: any) => x.sharedWith === 1 && x.phoneMasked === '•••• 9900')).toBe(true);
  });
  it('the old-number notice is shown as submitted, then delivered — from the ledger row, never assumed', async () => {
    const c = await customer(num(60));
    const st = { sessionId: await request(c, num(61), { state: 'customer_records_synchronized' }) };
    expect((await center.detail(pc(), st.sessionId) as any).oldNumberNotice.state).toBe('not_recorded');
    const nid = (await sql<any>`insert into notifications (tenant_id, channel, to_address, body, status, source_type, source_id) values (${T}, 'sms', ${num(60)}, 'notice', 'sent', 'phone_change', ${st.sessionId}) returning id`.execute(db)).rows[0].id;
    expect((await center.detail(pc(), st.sessionId) as any).oldNumberNotice.state).toBe('submitted');
    await sql`update notifications set status = 'delivered', delivered_at = now() where id = ${nid}`.execute(db);
    expect((await center.detail(pc(), st.sessionId) as any).oldNumberNotice.state).toBe('delivered');
  });
  it('sender readiness: none → not configured; configured but never checked → unchecked, not "verified"; no secret in the answer', async () => {
    expect((await center.health(pc()) as any).items[0].state).toBe('not_configured');
    await sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, verify_service_sid, status) values (${T}, 'twilio', 'AC_TEST_SID_VALUE', 'enc:secret-token', 'VA_TEST_SERVICE', 'configured')`.execute(db);
    const h: any = await center.health(pc());
    expect(h.items[0].state).toBe('unchecked');
    expect(h.items[0].kind).toBe('twilio_verify');
    expect(JSON.stringify(h)).not.toMatch(/AC_TEST_SID_VALUE|secret-token|VA_TEST_SERVICE/);
    expect((await center.summary(pc())).kpis.smsHealth.value).toBe('unchecked');
  });
});

describe('tenant isolation', () => {
  it('another salon\'s requests are invisible, its request id is a 404, and searching cannot reach it', async () => {
    const other = await customer(num(70), T2, 'Other Salon Person');
    const st = { sessionId: await request(other, num(71), { tenantId: T2 }) };
    await expect(center.detail(pc(), st.sessionId)).rejects.toMatchObject({ apiCode: 'PHONE_UPDATE_NOT_FOUND' });
    expect((await center.history(pc(), { q: st.sessionId }) as any).totalItems).toBe(0);
    expect((await center.history(pc(), { q: 'other salon' }) as any).totalItems).toBe(0);
    expect((await center.customers(pc(), { q: 'other salon' }) as any).totalItems).toBe(0);
    expect((await center.history(pc(undefined, T2), {}) as any).totalItems).toBe(1);
  });
});

describe('PHONE NUMBER MANAGEMENT 4 · 06 — suspicious number change review (review only)', () => {
  it('frequent changes, repeated failed requests and several channels go to review with their reasons; an ordinary change does not; nothing is changed', async () => {
    // bare change requests (only the session rows the review reads)
    const sess = async (cid: string, phone: string, o: { state?: string; minAgo?: number; source?: string; t?: string; done?: boolean } = {}) => String((await sql<any>`insert into customer_phone_update_sessions
        (tenant_id, branch_id, customer_id, proposed_phone, proposed_phone_hash, proposed_phone_mask, state, update_source, requested_by_role, created_at, updated_at, completed_at)
      values (${o.t ?? T}, ${(o.t ?? T) === T ? B : B2}, ${cid}, ${phone}, ${phoneKey(phone)}, ${maskPhone(phone)}, ${o.state ?? 'pending_phone_saved'}, ${o.source ?? 'staff_pos'}, 'RECEPTION',
        now() - make_interval(mins => ${o.minAgo ?? 0}), now(), ${o.done ? sql`now()` : null}) returning id`.execute(db)).rows[0].id);
    const often = await customer(num(901), T, 'Often Changer');
    await sess(often, num(902), { state: 'update_canceled', minAgo: 300, done: true });
    await sess(often, num(903), { state: 'update_canceled', minAgo: 200, done: true });
    const latest = await sess(often, num(904), { minAgo: 10 });
    const failing = await customer(num(911), T, 'Code Misser');
    await sess(failing, num(912), { state: 'verification_failed', minAgo: 60, done: true });
    await sess(failing, num(913), { state: 'verification_expired', minAgo: 30, source: 'customer_app' });
    const calm = await customer(num(921), T, 'Calm Customer');
    await sess(calm, num(922), { minAgo: 5 });
    const elsewhere = await customer(num(931), T2, 'Other Salon');
    for (const i of [932, 933, 934]) await sess(elsewhere, num(i), { t: T2, state: 'update_canceled', done: true });
    const before = (await sql<any>`select id, state from customer_phone_update_sessions where tenant_id = ${T} order by id`.execute(db)).rows;
    const r: any = (await center.summary(pc())).risk;
    expect(r).toMatchObject({ windowDays: 30, action: 'review_only', thresholds: { changes: 3, failedRequests: 2 } });
    const by = Object.fromEntries(r.items.map((x: any) => [x.customerId, x]));
    expect(by[often]).toMatchObject({ customerName: 'Often Changer', changes: 3, latestRequestId: latest });
    expect(by[often].reasons).toContain('frequent_changes');
    expect(by[failing]).toMatchObject({ changes: 2, failedRequests: 2, channels: 2 });
    expect(by[failing].reasons).toEqual(['failed_codes', 'cross_device']);
    expect(by[calm]).toBeUndefined();
    expect(by[elsewhere]).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/\+1856/);                       // never a phone number (or an address)
    expect((await sql<any>`select id, state from customer_phone_update_sessions where tenant_id = ${T} order by id`.execute(db)).rows).toEqual(before);
  });
});

// extras round 10 (agent 5): PHONE NUMBER MANAGEMENT 4 · 11 timeline · 13 monthly report · 15 replay dry run
describe('PHONE NUMBER MANAGEMENT 4 round 10', () => {
  it('11: the timeline lists Requested → SMS Sent → Verified → Applied → Synced → Security Notice with each record\'s own time; unreached steps have none; provider refs only by their last four', async () => {
    const c = await customer(num(70));
    const id = await request(c, num(71), { state: 'customer_records_synchronized' });
    await sql`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, customer_id, phone_hash, phone_mask, channel, status, expires_at, last_sent_at, delivered_at, verified_at, provider_verification_sid)
      values (${T}, ${B}, ${id}, ${c}, ${phoneKey(num(71))}, ${maskPhone(num(71))}, 'front_desk', 'verified', now() + interval '5 minutes', now() - interval '3 minutes', now() - interval '2 minutes', now() - interval '1 minute', 'VE1234567890abcdWXYZ')`.execute(db);
    await sql`insert into notifications (tenant_id, channel, to_address, body, status, source_type, source_id, provider_id, delivered_at) values (${T}, 'sms', ${num(70)}, 'notice', 'delivered', 'phone_change', ${id}, 'SMabcdef0000Q9R8', now())`.execute(db);
    const d: any = await center.detail(pc(), id);
    expect(d.timeline.map((e: any) => e.key)).toEqual(['requested', 'sms_sent', 'verified', 'applied', 'synced', 'security_notice']);
    expect(d.timeline.every((e: any) => e.reached && e.at)).toBe(true);
    const sent = d.timeline.find((e: any) => e.key === 'sms_sent');
    expect(sent).toMatchObject({ verified: true, detail: 'delivered', providerRef: '…WXYZ' });
    expect(d.timeline.find((e: any) => e.key === 'security_notice')).toMatchObject({ verified: true, providerRef: '…Q9R8' });
    expect(JSON.stringify(d.timeline)).not.toContain('VE1234567890');
    // a pending change: only Requested is reached; nothing is given a time it does not have
    const c2 = await customer(num(72));
    const open: any = await center.detail(pc(), await request(c2, num(73)));
    expect(open.timeline.filter((e: any) => e.reached).map((e: any) => e.key)).toEqual(['requested']);
    expect(open.timeline.filter((e: any) => !e.reached).every((e: any) => e.at === null && e.verified === false)).toBe(true);
    // a manual exception is applied but never "verified"
    const c3 = await customer(num(74));
    const man: any = await center.detail(pc(), await request(c3, num(75), { state: 'phone_activated', provider: 'staff_override' }));
    expect(man.timeline.find((e: any) => e.key === 'verified').reached).toBe(false);
    expect(man.timeline.find((e: any) => e.key === 'applied')).toMatchObject({ reached: true, detail: 'manual_exception' });
  });
  it('15: the replay dry run says exactly what Retry Sync would do for ONE change and writes nothing; ineligible changes and viewers get the refusal code', async () => {
    const c = await customer(num(80));
    const id = await request(c, num(81), { state: 'synchronization_failed' });
    await sql`insert into jobs (job_class, job_type, tenant_id, payload, idempotency_key, status, attempts, last_error) values ('standard', ${PHONE_JOB.sync}, ${T}, '{}'::jsonb, ${'sync:' + id}, 'dead', 8, 'identity service timeout')`.execute(db);
    const tally = async () => (await sql<any>`select (select count(*) from jobs) + (select count(*) from audit_logs) + (select count(*) from customer_phone_update_sessions where state = 'synchronization_failed') as n`.execute(db)).rows[0].n;
    const before = await tally();
    const d: any = await center.detail(pc(), id);
    expect(d.replayPreview).toMatchObject({ eligible: true, refusal: null, batch: false, writesNow: false, idempotencyKey: 'sync:' + id, attemptsSoFar: 8, lastError: 'identity service timeout', wouldChange: ['customer_records', 'request_state', 'audit_row'] });
    expect(d.replayPreview.eligible).toBe(d.actions.retrySync);          // the same rule the Retry button uses
    const viewer: any = await center.detail(pc(['pos.customers.view']), id);
    expect(viewer.replayPreview).toMatchObject({ eligible: false, refusal: 'PERMISSION_DENIED', wouldChange: [] });
    const c2 = await customer(num(82));
    const synced: any = await center.detail(pc(), await request(c2, num(83), { state: 'customer_records_synchronized' }));
    expect(synced.replayPreview).toMatchObject({ eligible: false, refusal: 'PHONE_SYNC_NOTHING_LEFT' });
    expect(await tally()).toEqual(before);
  });
  it('13: the monthly report counts requests, verified changes (manual shown apart), failed attempts, shared contacts and pending sync per month and branch — one salon only — with its denominators', async () => {
    const T3 = 'a7420000-0000-4000-8000-000000000003', B3 = 'a7420000-0000-4000-8000-0000000000b3', B4 = 'a7420000-0000-4000-8000-0000000000b4';
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T3}, 'pc-c', 'pc-c', 'pc-c', 'PCC01', 'active')`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B3}, ${T3}, 'Main', 'America/New_York'), (${B4}, ${T3}, 'Haddon', 'America/New_York')`.execute(db);
    const mk = async (phone: string, name: string) => String((await sql<any>`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values (${T3}, ${B3}, ${name}, 'M', ${name + ' M'}, ${phone}) returning id`.execute(db)).rows[0].id);
    const sess = async (cust: string, phone: string, state: string, branch: string, provider: string | null = null) => {
      const np = String((await sql<any>`insert into customer_phones (tenant_id, customer_id, normalized_phone, phone_mask, phone_hash, status, verification_provider, update_source)
        values (${T3}, ${cust}, ${phone}, ${maskPhone(phone)}, ${phoneKey(phone)}, ${PROVEN.includes(state) ? (provider === 'staff_override' ? 'active_unverified' : 'active_verified') : 'pending_verification'}, ${provider}, 'staff_pos') returning id`.execute(db)).rows[0].id);
      await sql`insert into customer_phone_update_sessions (tenant_id, branch_id, customer_id, proposed_phone, proposed_phone_hash, proposed_phone_mask, new_phone_id, state, update_source, requested_by_role)
        values (${T3}, ${branch}, ${cust}, ${phone}, ${phoneKey(phone)}, ${maskPhone(phone)}, ${np}, ${state}, 'staff_pos', 'RECEPTION')`.execute(db);
    };
    const a = await mk('+18565550301', 'Ana'), b = await mk('+18565550302', 'Bo'), cc = await mk('+18565550303', 'Cy'), dd = await mk('+18565550304', 'Dee');
    await sess(a, '+18565550311', 'customer_records_synchronized', B3, 'twilio_verify');     // verified
    await sess(b, '+18565550312', 'synchronization_failed', B3, 'staff_override');          // verified (manual) + pending sync
    await sess(cc, '+18565550399', 'verification_failed', B4);                              // failed (a number nobody else has)
    await sess(dd, '+18565550302', 'pending_phone_saved', B4);                              // shared: Bo's number
    const s: any = await center.summary({ tenantId: T3, branchId: B3, userId: U, role: 'OWNER', permissions: ALL });
    const m = s.monthly;
    expect(Object.keys(m.denominators).sort()).toEqual(['failedAttempts', 'pendingSync', 'requests', 'sharedContacts', 'verifiedChanges']);
    const main = m.rows.find((r: any) => r.branchName === 'Main'), haddon = m.rows.find((r: any) => r.branchName === 'Haddon');
    expect(main).toMatchObject({ requests: 2, verifiedChanges: 2, manualExceptions: 1, failedAttempts: 0, sharedContacts: 0, pendingSync: 1 });
    expect(haddon).toMatchObject({ requests: 2, verifiedChanges: 0, failedAttempts: 1, sharedContacts: 1, pendingSync: 0 });
    expect(m.rows.every((r: any) => /^\d{4}-\d{2}$/.test(r.month))).toBe(true);
    expect(m.rows).toHaveLength(2);                                                          // this salon's rows only
  });
});
