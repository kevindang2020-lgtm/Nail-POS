// duplicate-review-center.pgtest — Duplicate Review guides (FULL + COMPLETE, Nov 1 2026; migration 761) on the REAL schema.
// IDs in the test names follow the guides' acceptance matrix: DT detection · SR search/dates/pages · CP comparison ·
// RV review decisions · MG merge · HL health · SC security. Every customer below is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DuplicateReviewCenter, DuplicateReviewError } from './duplicate-review-center';
import { DuplicateReviewCenterController } from './duplicate-review-center.controller';
import { assessEvidence, classifyConfidence, legacyConfidence, presetRange } from './duplicate-review-core';

const P = 'c7610000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), FD = id(11), LAN = id(20);
const C = {
  testA: id(101), testB: id(102),                    // the screenshot: two "test", one phone, no emails
  lan1: id(103), lan2: id(104),                      // same common name, different phones → two people
  mom: id(105), son: id(106),                        // shared family phone, different names
  amyA: id(107), amyB: id(108),                      // same email + same name → strong
  joA: id(109), joB: id(110),                        // phone + email + name → exact
  triA: id(111), triB: id(112), triC: id(113),       // a group of three
  arch1: id(114), arch2: id(115),                    // archived twin: never grouped
  b2a: id(116), b2b: id(117),                        // both at branch 2 only
  xHang: id(130),                                    // another salon, same phone as Jo
};
const owner = (perms = ['pos.customers.view', 'pos.customers.edit', 'pos.customers.merge', 'pos.customers.export']) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: perms }) as any;
const viewer = () => ({ tenantId: T, branchId: B, userId: FD, role: 'FRONT_DESK', permissions: ['pos.customers.view'] }) as any;
const confinedB2 = () => ({ tenantId: T, branchId: B2, userId: FD, role: 'FRONT_DESK', permissions: ['pos.customers.view', 'pos.customers.edit', 'pos.customers.merge'], authz: { scope: 'BRANCH', branchIds: [B2] } }) as any;
let db: any; let dr: DuplicateReviewCenter; let clock = Date.now();
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_trx: any, meta: any) => { audits.push(meta); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof DuplicateReviewError ? e.code : `${(e as any)?.status ?? (e as any)?.code ?? ''}:${(e as Error).message}`; } }
async function cust(cid: string, name: string, phone: string | null, email: string | null, o: { tenant?: string; branch?: string; at?: string } = {}) {
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email, status, created_at, updated_at)
    values (${cid}, ${o.tenant ?? T}, ${o.branch ?? B}, ${name.split(' ')[0]}, ${name.split(' ').slice(1).join(' ') || ''}, ${name}, ${phone}, ${phone}, ${email}, 'active',
      ${o.at ?? '2026-10-01T15:00:00Z'}::timestamptz, ${o.at ?? '2026-10-01T15:00:00Z'}::timestamptz)`);
}
let tk = 0;
async function ticket(customer: string, status = 'paid', branch = B) {
  await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
    values (${T}, ${branch}, ${customer}, ${status}, 4500, ${++tk}, now() - interval '5 days', now() - interval '5 days')`);
}
async function appt(customer: string, dayOffset: number, status = 'booked') {
  await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
    values (${T}, ${B}, ${LAN}, ${customer}, 'x', (now() at time zone 'America/New_York')::date + ${dayOffset}::int, '10:00', '11:00', ${status}, '[]')`);
}
const groupOf = async (member: string) => (await q(sql`select *, member_ids::text[] as member_ids from customer_duplicate_groups where tenant_id = ${T} and ${member}::uuid = any(member_ids) order by member_count desc`))[0];
const forced = async () => { clock += 120_000; return dr.scan(owner()); };   // step past the 60 s scan gap

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); dr = new DuplicateReviewCenter(db, null, () => clock);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot Nail Salon', 'dr-761', 'DR761', 'active'), (${X}, 'X', 'Other Salon', 'dr-761x', 'DR761X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@dr.test', 'active', 'OWNER'), (${FD}, ${T}, 'Desk', 'fd@dr.test', 'active', 'FRONT_DESK')`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Tran', 'Lan Tran')`);
  // the cross-tenant reference trigger refuses fixtures that point across salons; nothing below does, but the
  // other salon's customer shares Jo's phone + email ON PURPOSE (it must never be grouped with Jo)
  await cust(C.testA, 'test', null, null); await cust(C.testB, 'test', '+16095550001', null);
  await cust(C.lan1, 'Lan Nguyễn', '+16095550010', null); await cust(C.lan2, 'Lan Nguyen', '+16095550011', null);
  await cust(C.mom, 'Linh Pham', '+16095550020', null); await cust(C.son, 'Minh Pham', '+16095550020', null);
  await cust(C.amyA, 'Amy Lee', null, 'amy@example.com'); await cust(C.amyB, 'Amy  Lee', '+16095550030', 'AMY@example.com ');
  await cust(C.joA, 'Jo Ho', '+16095550040', 'jo@example.com'); await cust(C.joB, 'Jo Ho', '+16095550040', 'jo@example.com');
  await cust(C.triA, 'Tri Vo', '+16095550050', null); await cust(C.triB, 'Tri Vo', '+16095550050', null); await cust(C.triC, 'Tri Vo', '+16095550050', null);
  await cust(C.arch1, 'Zed Arch', '+16095550060', null); await cust(C.arch2, 'Zed Arch', '+16095550060', null);
  await q(sql`update customers set archived_at = now(), status = 'archived' where id = ${C.arch2}`);
  await cust(C.b2a, 'Bea Two', '+16095550070', null, { branch: B2 }); await cust(C.b2b, 'Bea Two', '+16095550070', null, { branch: B2 });
  await cust(C.xHang, 'Jo Ho', '+16095550040', 'jo@example.com', { tenant: X, branch: BX });
  // 21 profiles sharing the salon's own placeholder number — not a person, never one group
  for (let i = 0; i < 21; i++) await cust(id(400 + i), `Walk In ${String.fromCharCode(65 + i)}${i}`, '+16095559999', null);
});

describe('Duplicate Review — rules (pure)', () => {
  it('DT-00 the screenshot rule: a blank phone is not a matching phone; name alone is Possible (the old rule said Strong)', () => {
    const m = [{ id: 'a', phone: null, email: null, nameKey: 'test', phoneVerified: false }, { id: 'b', phone: '+1609', email: null, nameKey: 'test', phoneVerified: false }];
    const e = assessEvidence(m);
    expect(e.signals.find((s) => s.field === 'phone')!.state).toBe('partial');
    expect(classifyConfidence(e)).toBe('possible');
    expect(e.why).toEqual(expect.arrayContaining(['name_only', 'contact_missing_on_some']));
    expect(legacyConfidence(m)).toBe('strong');
  });
  it('DT-00b presets resolve to salon-local day ranges', () => {
    expect(presetRange('yesterday', '2026-11-02')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(presetRange('last_7', '2026-11-02')).toEqual({ from: '2026-10-27', to: '2026-11-02' });
    expect(presetRange('last_month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('week', '2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });
});

describe('Duplicate Review — detection', () => {
  it('DT-01 scan groups real candidates and labels each by evidence, not by name', async () => {
    const r = await dr.scan(owner());
    expect(r.reused).toBe(false);
    const g = async (m: string) => { const x = await groupOf(m); return x && { conf: x.confidence, reasons: x.reasons, why: x.evidence.why, n: x.member_count }; };
    expect(await g(C.testA)).toMatchObject({ conf: 'possible', reasons: ['name'], n: 2 });
    expect((await g(C.testA))!.why).toContain('name_only');
    expect(await g(C.lan1)).toMatchObject({ conf: 'possible', reasons: ['name'] });           // accent-folded name, different phones
    expect((await g(C.lan1))!.why).toContain('contact_conflict');
    expect(await g(C.mom)).toMatchObject({ conf: 'possible', reasons: ['phone'] });            // family phone ≠ one person
    expect((await g(C.mom))!.why).toContain('shared_contact_different_names');
    expect(await g(C.amyA)).toMatchObject({ conf: 'strong', reasons: ['email', 'name'] });     // trimmed / lower-cased email + spacing-folded name
    expect(await g(C.joA)).toMatchObject({ conf: 'exact', reasons: ['phone', 'email', 'name'] });
    expect(await g(C.triA)).toMatchObject({ n: 3, conf: 'strong' });                            // a group of three, one group
    expect(await groupOf(C.arch1)).toBeUndefined();                                            // archived twin excluded
    expect(await groupOf(C.xHang)).toBeUndefined();                                            // other salon never grouped
    expect(r.scan.oversizedKeys).toBe(1);                                                      // the shared placeholder number
    expect(await groupOf(id(400))).toBeUndefined();
  });
  it('DT-02 a rescan inside 60 s is reused; a later rescan keeps the same stable group ids and adds no duplicate events', async () => {
    expect((await dr.scan(owner())).reused).toBe(true);
    const before = (await groupOf(C.joA)).id;
    const evBefore = (await q(sql`select count(*)::int n from customer_duplicate_events where tenant_id = ${T}`))[0].n;
    const r = await forced();
    expect(r.scan.groupsNew).toBe(0);
    expect((await groupOf(C.joA)).id).toBe(before);
    expect((await q(sql`select count(*)::int n from customer_duplicate_events where tenant_id = ${T}`))[0].n).toBe(evBefore);
  });
  it('DT-03 a group no longer detected is resolved (history kept), and comes back if detected again', async () => {
    await q(sql`update customers set full_name = 'Lan Different', first_name = 'Lan', last_name = 'Different' where id = ${C.lan2}`);
    await forced();
    const g = await groupOf(C.lan1);
    expect(g.status).toBe('resolved');
    await q(sql`update customers set full_name = 'Lan Nguyen', last_name = 'Nguyen' where id = ${C.lan2}`);
    await forced();
    expect((await groupOf(C.lan1)).status).toBe('pending');
    const types = (await q(sql`select event_type from customer_duplicate_events where group_id = ${g.id} order by created_at, id`)).map((r) => r.event_type);
    expect(types).toEqual(['detected', 'resolved', 'reopened']);
  });
});

describe('Duplicate Review — queue, search, dates, pages', () => {
  it('SR-01 search: accent-free name, phone in any format, email, group id, customer id', async () => {
    const ids = async (qq: string) => (await dr.list(owner(), { q: qq, status: 'all' }, { fullContact: true })).items.map((i: any) => i.id);
    const lan = (await groupOf(C.lan1)).id, jo = (await groupOf(C.joA)).id, amy = (await groupOf(C.amyA)).id;
    expect(await ids('lan nguyen')).toContain(lan);
    expect(await ids('(609) 555-0040')).toContain(jo);
    expect(await ids('amy@exa')).toContain(amy);
    expect(await ids(jo)).toEqual([jo]);
    expect(await ids(C.amyB)).toEqual([amy]);
    expect(await code(dr.list(owner(), { q: 'x' }, { fullContact: true }))).toBe('DUPLICATE_SEARCH_TOO_SHORT');
  });
  it('SR-02 filters: confidence, reason, status; masked contact by default; "not provided" stays null, never zero', async () => {
    const strong = await dr.list(owner(), { confidence: 'strong' }, { fullContact: false });
    expect(strong.items.every((i: any) => i.confidence === 'strong')).toBe(true);
    const email = await dr.list(owner(), { reason: 'email' }, { fullContact: false });
    expect(email.items.every((i: any) => i.reasons.includes('email'))).toBe(true);
    const test = (await dr.list(owner(), { q: 'test' }, { fullContact: false })).items[0];
    const blank = test.members.find((m: any) => m.customerId === C.testA);
    expect(blank.phone).toBeNull(); expect(blank.email).toBeNull();
    expect(test.members.find((m: any) => m.customerId === C.testB).phone).toMatch(/^\(•••\) •••-0001$/);
  });
  it('SR-03 newest detected first, stable pages, total; a date range outside today empties the list; reversed range refused', async () => {
    await q(sql`update customer_duplicate_groups set detected_at = now() - (interval '1 day' * (member_count + length(group_key) % 7)) where tenant_id = ${T}`);
    const all = await dr.list(owner(), { pageSize: 10 }, { fullContact: false });
    const ts = all.items.map((i: any) => i.detectedAt);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect(all.total).toBeGreaterThanOrEqual(6);
    const p2 = await dr.list(owner(), { pageSize: 10, page: 2 }, { fullContact: false });
    expect(p2.items.filter((i: any) => all.items.some((a: any) => a.id === i.id))).toEqual([]);
    expect((await dr.list(owner(), { preset: 'custom', from: '2020-01-01', to: '2020-01-31' }, { fullContact: false })).total).toBe(0);
    expect((await dr.list(owner(), { preset: 'last_30' }, { fullContact: false })).total).toBe(all.total);
    expect(await code(dr.list(owner(), { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }, { fullContact: false }))).toBe('DUPLICATE_INVALID_PERIOD');
  });
  it('SR-04 a branch-confined reviewer sees only groups with a member in their branch', async () => {
    const r = await dr.list(confinedB2(), { status: 'all' }, { fullContact: false });
    expect(r.items.map((i: any) => i.members.map((m: any) => m.customerId).sort())).toEqual([[C.b2a, C.b2b].sort()]);
  });
});

describe('Duplicate Review — comparison + review decisions', () => {
  it('CP-01 side-by-side facts from the systems of record, audited; masked unless export', async () => {
    await ticket(C.joB); await appt(C.joB, 4);
    await q(sql`insert into loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance, delta, balance_after, entry_type, created_at) values (${T}, ${B}, ${C.joB}, 'earn', 50, 'checkout', 50, 50, 50, 'earn', now())`);
    await q(sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points) values (${T}, ${B}, ${C.joB}, 50, 50)`);
    const g = await groupOf(C.joA);
    audits.length = 0;
    const d = await dr.detail(viewer(), g.id, { fullContact: false, audit });
    const jb = d.members.find((m: any) => m.customerId === C.joB) as any;
    expect(jb).toMatchObject({ visits: 1, upcomingAppointments: 1, loyalty: { points: 50 } });
    expect(jb.phone).toMatch(/•••/);
    expect(audits).toHaveLength(1);
    expect(d.evidence.signals.map((s: any) => s.state)).toEqual(['match', 'match', 'match']);
  });
  it('CP-02 a confined reviewer cannot open a group outside their branches; another salon\'s group is not found', async () => {
    const g = await groupOf(C.joA);
    expect(await code(dr.detail(confinedB2(), g.id, { fullContact: false, audit }))).toBe('DUPLICATE_OUT_OF_SCOPE');
    expect(await code(dr.detail({ ...owner(), tenantId: X }, g.id, { fullContact: false, audit }))).toBe('DUPLICATE_GROUP_NOT_FOUND');
  });
  it('RV-01 Keep Separate needs a reason, records the decision and leaves the queue; identical evidence never re-flags it', async () => {
    const g = await groupOf(C.mom);
    expect(await code(dr.decide(owner(), g.id, { decision: 'keep_separate' }, audit))).toBe('DUPLICATE_REASON_REQUIRED');
    expect(await code(dr.decide(owner(), g.id, { decision: 'keep_separate', note: 'mother and son', expectedVersion: 999 }, audit))).toBe('DUPLICATE_STALE_VERSION');
    const r = await dr.decide(owner(), g.id, { decision: 'keep_separate', note: 'mother and son', expectedVersion: g.version }, audit);
    expect(r.status).toBe('kept_separate');
    await forced();
    expect((await groupOf(C.mom)).status).toBe('kept_separate');
    expect((await dr.list(owner(), {}, { fullContact: false })).items.map((i: any) => i.id)).not.toContain(g.id);
    expect((await q(sql`select decision from customer_duplicate_decisions where tenant_id = ${T} and customer_a = least(${C.mom}::uuid, ${C.son}::uuid)`))[0].decision).toBe('keep_separate');
  });
  it('RV-02 materially new evidence reopens a Keep Separate group — visibly, never silently', async () => {
    await q(sql`update customers set email = 'pham@example.com' where id = any(${[C.mom, C.son]}::uuid[])`);
    await forced();
    const g = await groupOf(C.mom);
    expect(g.status).toBe('pending');
    const last = (await q(sql`select event_type, payload from customer_duplicate_events where group_id = ${g.id} order by created_at desc, id desc limit 1`))[0];
    expect(last).toMatchObject({ event_type: 'reopened', payload: { from: 'kept_separate', reason: 'new_evidence' } });
  });
  it('RV-03 Review Later (defer) with a due date; notes are append-only', async () => {
    const g = await groupOf(C.testA);
    const r = await dr.decide(owner(), g.id, { decision: 'defer', note: 'ask at next visit', dueOn: '2026-12-01' }, audit);
    expect(r.status).toBe('deferred');
    await dr.addNote(owner(), g.id, { note: 'customer did not answer' });
    expect(await code(q(sql`update customer_duplicate_events set note = 'x' where group_id = ${g.id}`))).toMatch(/append-only/);
    expect(await code(q(sql`delete from customer_duplicate_events where group_id = ${g.id}`))).toMatch(/append-only/);
  });
});

describe('Duplicate Review — merge (human-confirmed only)', () => {
  const key = () => 'k-' + Math.random().toString(36).slice(2, 12);
  it('MG-01 "Merge into this" only proposes: the preview changes no customer data and records itself', async () => {
    const g = await groupOf(C.joA);
    const snap = await q(sql`select id, archived_at, updated_at from customers where id = any(${[C.joA, C.joB]}::uuid[]) order by id`);
    const p = await dr.preview(owner(), g.id, C.joA, { fullContact: false });
    expect(p.survivor.customerId).toBe(C.joA);
    expect(p.sources.map((s: any) => s.customerId)).toEqual([C.joB]);
    expect(p.moves).toMatchObject({ tickets: 1, pos_tech_appointments: 1 });
    expect(p.acknowledgements.map((a: any) => a.code)).toEqual(expect.arrayContaining(['FUTURE_APPOINTMENTS']));
    expect(p.canMerge).toBe(true);
    expect(await q(sql`select id, archived_at, updated_at from customers where id = any(${[C.joA, C.joB]}::uuid[]) order by id`)).toEqual(snap);
    expect((await q(sql`select count(*)::int n from customer_duplicate_events where group_id = ${g.id} and event_type = 'merge_previewed'`))[0].n).toBe(1);
  });
  it('MG-02 confirm refuses: no confirm flag, missing acknowledgement, wrong hash, changed data since preview', async () => {
    const g = await groupOf(C.joA);
    const p = await dr.preview(owner(), g.id, C.joA, { fullContact: false });
    const acks = p.acknowledgements.map((a: any) => a.code);
    expect(await code(dr.confirm(owner(), g.id, { survivorId: C.joA, previewHash: p.previewHash, idempotencyKey: key(), acknowledged: acks }, audit))).toBe('DUPLICATE_CONFIRMATION_REQUIRED');
    expect(await code(dr.confirm(owner(), g.id, { survivorId: C.joA, previewHash: p.previewHash, idempotencyKey: key(), acknowledged: [], confirm: true }, audit))).toBe('DUPLICATE_ACK_REQUIRED');
    expect(await code(dr.confirm(owner(), g.id, { survivorId: C.joA, previewHash: 'deadbeefdeadbeef', idempotencyKey: key(), acknowledged: acks, confirm: true }, audit))).toBe('DUPLICATE_STALE_PREVIEW');
    await appt(C.joB, 6);   // a new booking after the preview
    expect(await code(dr.confirm(owner(), g.id, { survivorId: C.joA, previewHash: p.previewHash, idempotencyKey: key(), acknowledged: acks, confirm: true }, audit))).toBe('DUPLICATE_STALE_PREVIEW');
    expect((await q(sql`select archived_at from customers where id = ${C.joB}`))[0].archived_at).toBeNull();
  });
  it('MG-03 blocked: a source with an open ticket cannot be merged (and the block is not "success")', async () => {
    const g = await groupOf(C.triA);
    await ticket(C.triC, 'open');
    const p = await dr.preview(owner(), g.id, C.triA, { fullContact: false });
    expect(p.blockers.map((b: any) => b.code)).toContain('OPEN_TICKET');
    expect(p.canMerge).toBe(false);
    expect(await code(dr.confirm(owner(), g.id, { survivorId: C.triA, previewHash: p.previewHash, idempotencyKey: key(), acknowledged: p.acknowledgements.map((a: any) => a.code), confirm: true }, audit))).toBe('DUPLICATE_MERGE_BLOCKED');
    expect((await groupOf(C.triA)).status).not.toBe('merged');
  });
  it('MG-04 a confirmed merge moves bookings, visits and points through the ledger, archives the source, and is idempotent', async () => {
    const g = await groupOf(C.joA);
    const p = await dr.preview(owner(), g.id, C.joA, { fullContact: false });
    const k = key();
    audits.length = 0;
    const r = await dr.confirm(owner(), g.id, { survivorId: C.joA, previewHash: p.previewHash, idempotencyKey: k, acknowledged: p.acknowledgements.map((a: any) => a.code), confirm: true }, audit);
    expect(r).toMatchObject({ status: 'completed', replayed: false });
    expect((await q(sql`select count(*)::int n from tickets where customer_id = ${C.joA}`))[0].n).toBe(1);
    expect((await q(sql`select count(*)::int n from pos_tech_appointments where customer_id = ${C.joA}`))[0].n).toBe(2);
    expect((await q(sql`select points_balance from customer_loyalty_profiles where customer_id = ${C.joA}`))[0].points_balance).toBe(50);
    expect((await q(sql`select coalesce(sum(delta),0)::int s from loyalty_ledger where customer_id = ${C.joB}`))[0].s).toBe(0);   // moved out on the ledger
    expect((await q(sql`select archived_at from customers where id = ${C.joB}`))[0].archived_at).not.toBeNull();
    expect((await groupOf(C.joA))).toMatchObject({ status: 'merged', survivor_id: C.joA });
    expect(audits).toHaveLength(1);
    const ledgerRows = (await q(sql`select count(*)::int n from loyalty_ledger where tenant_id = ${T} and entry_type = 'merge'`))[0].n;
    const again = await dr.confirm(owner(), g.id, { survivorId: C.joA, previewHash: p.previewHash, idempotencyKey: k, acknowledged: [], confirm: true }, audit);
    expect(again).toMatchObject({ status: 'completed', replayed: true, operationId: r.operationId });
    expect((await q(sql`select count(*)::int n from loyalty_ledger where tenant_id = ${T} and entry_type = 'merge'`))[0].n).toBe(ledgerRows);
    // a second, different request on the merged group is refused and recorded as a failed attempt
    expect(await code(dr.confirm(owner(), g.id, { survivorId: C.joA, previewHash: p.previewHash, idempotencyKey: key(), acknowledged: [], confirm: true }, audit))).toBe('DUPLICATE_ALREADY_MERGED');
    expect((await q(sql`select status from customer_duplicate_merge_ops where group_id = ${g.id} order by created_at`)).map((x) => x.status)).toEqual(['completed', 'failed']);
  });
  it('SC-01 the merge endpoint refuses a role without pos.customers.merge (server-side); Keep Separate too', async () => {
    const ctl = new DuplicateReviewCenterController(dr);
    const g = await groupOf(C.amyA);
    const req = { ctx: { tenantId: T, branchId: B, userId: FD, role: 'FRONT_DESK', permissions: ['pos.customers.view', 'pos.customers.edit'] } };
    expect(await code((async () => ctl.merge(req, g.id, { survivorId: C.amyA, previewHash: 'x'.repeat(40), idempotencyKey: key(), confirm: true }))())).toMatch(/^403/);
    expect(await code((async () => ctl.decide(req, g.id, { decision: 'keep_separate', note: 'x' }))())).toMatch(/^403/);
    expect(await code(ctl.decide(req, g.id, { decision: 'in_review' }))).toBe('ok');
  });
});

describe('Duplicate Review — history + health', () => {
  it('HS-01 history is newest-first and filterable by group and type', async () => {
    const g = await groupOf(C.joA);
    const h = await dr.history(owner(), { groupId: g.id });
    const ts = h.items.map((i: any) => i.at);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect(h.items[0].type).toBe('merge_failed');
    expect((await dr.history(owner(), { eventType: 'merged' })).items.every((i: any) => i.type === 'merged')).toBe(true);
    expect(await code(dr.history(owner(), { groupId: 'nope' }))).toBe('DUPLICATE_INVALID_FILTER');
  });
  it('HL-01 the health check is read-only, explains the old "Strong" label, and verifies the completed merge', async () => {
    // a group labelled by the OLD rule (as the screenshot was): name only, but legacyLabel strong
    const before = await q(sql`select id, updated_at, archived_at, record_version from customers where tenant_id = ${T} order by id`);
    const r = await dr.check(owner());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.confidence_rule.state).toBe('PASSED');
    expect(by.legacy_overconfidence.state).toBe('WARNING');          // the "test" pair: the old rule said Strong
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.normalizers.state).toBe('PASSED');
    expect(by.indexes.state).toBe('PASSED');
    expect(by.merge_integrity.state).toBe('PASSED');
    expect(by.loyalty_after_merge.state).toBe('PASSED');
    expect(by.oversized_keys.state).toBe('WARNING');
    expect(await q(sql`select id, updated_at, archived_at, record_version from customers where tenant_id = ${T} order by id`)).toEqual(before);
    expect((await dr.check(owner())).reused).toBe(true);
  });
  it('HL-02 freshness is real: never → up to date → stale', async () => {
    const other = { tenantId: X, branchId: BX, userId: OWNER, role: 'OWNER', permissions: ['pos.customers.view'] } as any;
    expect((await dr.freshness(other)).state).toBe('never');
    await dr.scan(other);
    expect((await dr.freshness(other)).state).toBe('up_to_date');
    clock += 16 * 60_000;
    expect((await dr.freshness(other)).state).toBe('stale');
  });
  it('HL-03 extras Customer 02: customer data integrity — orphaned references, bookings on archived profiles, repeated loyalty postings, consent vs opt-out', async () => {
    const fresh = async () => { await q(sql`delete from customer_duplicate_health_runs where tenant_id = ${T}`); const r = await dr.check(owner()); return Object.fromEntries(r.checks.map((c: any) => [c.key, c])); };
    let by = await fresh();
    for (const k of ['orphan_references', 'archived_with_bookings', 'loyalty_repeat_entries', 'consent_conflict']) expect(by[k].state).toBe('PASSED');
    // an orphan: a booking whose customer was deleted (no ticket holds the profile, so nothing stops the delete)
    const gone = id(620), arch = id(621), opt = id(622);
    await cust(gone, 'Gone Guest', '+16095550620', null); await appt(gone, 41);
    await q(sql`delete from customers where id = ${gone}`);
    // an archived (not merged) profile with an upcoming booking; its past booking does not count
    await cust(arch, 'Archie Old', '+16095550621', null); await appt(arch, 42); await appt(arch, -43);
    await q(sql`update customers set archived_at = now(), status = 'archived' where id = ${arch}`);
    // the same loyalty posting twice (legacy rows without a source key)
    await cust(opt, 'Opal Opt', '+16095550622', 'opal@example.com');
    const ref = id(623);
    for (let i = 0; i < 2; i++) await q(sql`insert into loyalty_ledger (tenant_id, customer_id, type, amount, source, reference_id, running_balance) values (${T}, ${opt}, 'earn', 10, 'ticket', ${ref}, ${10 * (i + 1)})`);
    // opted in to SMS marketing while the phone is on the opt-out list
    await q(sql`update customers set marketing_sms_opt_in = true where id = ${opt}`);
    await q(sql`insert into notification_opt_outs (tenant_id, channel, address, reason) values (${T}, 'sms', '+16095550622', 'STOP')`);
    const before = await q(sql`select id, archived_at, marketing_sms_opt_in from customers where tenant_id = ${T} order by id`);
    by = await fresh();
    expect(by.orphan_references).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.orphan_references.evidence).toMatch(/1 booking\(s\), 0 gift card/);
    expect(by.archived_with_bookings).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.loyalty_repeat_entries).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.consent_conflict).toMatchObject({ state: 'WARNING', count: 1 });
    expect(await q(sql`select id, archived_at, marketing_sms_opt_in from customers where tenant_id = ${T} order by id`)).toEqual(before);   // read-only
    expect((await q(sql`select count(*)::int as n from loyalty_ledger where customer_id = ${opt}`))[0].n).toBe(2);
    // another salon's check sees none of it
    const other = { tenantId: X, branchId: BX, userId: OWNER, role: 'OWNER', permissions: ['pos.customers.view'] } as any;
    const ob = Object.fromEntries((await dr.check(other)).checks.map((c: any) => [c.key, c]));
    for (const k of ['orphan_references', 'archived_with_bookings', 'loyalty_repeat_entries', 'consent_conflict']) expect(ob[k].state).toBe('PASSED');
  });
});
