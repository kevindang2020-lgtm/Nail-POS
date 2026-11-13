// customer-unmerge.pgtest — extras Customer 08 "Safe import/merge staging and recovery": undo a completed merge, against the REAL
// schema. Every merge leaves a reversible-merge record (customer_merge_snapshots); an unmerge restores exactly the moved rows,
// tags, loyalty profile and points from it — only while nothing touched the merged rows since — and is audited in the same
// transaction. A touched row, a loyalty entry after the merge, an already-undone merge or another salon's merge is refused with
// a code and changes nothing. The snapshot itself cannot be edited or deleted.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { recordAuditStrict } from '@aipowersalon/audit';
import { mergeCustomersTx } from './customer-merge';
import { applyLoyaltyEntry } from '../loyalty/loyalty-ledger.service';
import { DuplicateReviewCenter, DuplicateReviewError } from '../duplicate-review/duplicate-review-center';

const P8 = 'c08a0000-0000-4000-8000-0000000';
const id = (n: string) => P8 + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), U = id('ee1');
const [P, D, E, F, G, H] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(id);
let db: Kysely<any>; let dr: DuplicateReviewCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.customers.view', 'pos.customers.merge'] } as any;
const audit = (trx: any, meta: Record<string, unknown>) => recordAuditStrict(trx, { tenantId: T, branchId: B, userId: U, role: 'OWNER' }, { module: 'customers', action: 'customer.unmerged', resourceType: 'customer_merge', resourceId: String(meta.snapshotId), summary: 'Customer merge undone', metadata: meta });
const merge = (survivor: string, src: string, tenant = T) => db.transaction().execute((trx) => mergeCustomersTx(trx, { tenantId: tenant, branchId: B, userId: U }, survivor, [src], { groupId: 'c08-' + src.slice(-3) }, null));
const snapOf = async (survivor: string) => (await q(sql`select id, status, snapshot from customer_merge_snapshots where survivor_customer_id = ${survivor} order by merged_at desc limit 1`))[0];
const codeOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof DuplicateReviewError ? { code: e.code, status: e.status } : String(e); } };

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()) as unknown as Kysely<any>;
  for (const [t, code] of [[T, 'C08A'], [T2, 'C08B']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${code}, ${code}, ${code.toLowerCase()}, ${code}, 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active'), (${B2}, ${T2}, 'Other', 'active')`.execute(db);
  await sql`insert into users (id, tenant_id, email, full_name, role, status) values (${U}, ${T}, 'owner-c08@example.com', 'Owner Kim', 'OWNER', 'active')`.execute(db);
  const cust = (cid: string, first: string, tenant = T, branch = B) => sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${cid}, ${tenant}, ${branch}, ${first}, 'Lopez', ${first + ' Lopez'}, '+18565550199', 'active')`.execute(db);
  await cust(P, 'Maria'); await cust(D, 'Mary'); await cust(E, 'Eva'); await cust(F, 'Eve'); await cust(G, 'Gia'); await cust(H, 'Gina');
  await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points) values (${T}, ${B}, ${P}, 100, 100), (${T}, ${B}, ${D}, 40, 60), (${T}, ${B}, ${H}, 30, 30)`.execute(db);
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents) values (${id('d1')}, ${T}, ${B}, ${D}, 'paid', 6000), (${id('d2')}, ${T}, ${B}, ${D}, 'paid', 3000), (${id('d3')}, ${T}, ${B}, ${F}, 'paid', 4500)`.execute(db);
  await sql`insert into gift_cards (tenant_id, branch_id, code, balance_cents, status, customer_id) values (${T}, ${B}, 'C08-GC-D', 2500, 'active', ${D})`.execute(db);
  await sql`insert into customer_tags (tenant_id, customer_id, tag) values (${T}, ${P}, 'vip'), (${T}, ${D}, 'vip'), (${T}, ${D}, 'late')`.execute(db);
  dr = new DuplicateReviewCenter(db);
}, 180_000);

describe('Customer 08 — undo a completed merge from its snapshot', () => {
  it('every merge leaves a reversible-merge record with the moved rows and their fingerprints', async () => {
    await merge(P, D);
    const s = await snapOf(P);
    expect(s.status).toBe('active');
    const snap = typeof s.snapshot === 'string' ? JSON.parse(s.snapshot) : s.snapshot;
    expect(snap.rowsBySource.tickets[D].sort()).toEqual([id('d1'), id('d2')].sort());
    expect(Object.keys(snap.fingerprints.tickets)).toHaveLength(2);
    expect(snap.tags).toEqual([{ customerId: D, moved: ['late'], dropped: ['vip'] }]);
    expect(snap.loyaltyProfiles[0]).toMatchObject({ customerId: D, points: 40, earned: 60 });
    const page = await dr.merges(ctx, {});
    expect(page.items[0]).toMatchObject({ status: 'active', survivor: { id: P, name: 'Maria Lopez' }, sources: [{ id: D, name: 'Mary Lopez' }] });
  });

  it('unmerge restores exactly the moved rows, tags, loyalty profile and points; later survivor rows stay; audited; once only', async () => {
    const s = await snapOf(P);
    await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents) values (${id('d9')}, ${T}, ${B}, ${P}, 'paid', 1200)`.execute(db);   // after the merge
    expect(await dr.unmergeCheck(ctx, s.id)).toMatchObject({ ok: true });
    expect(await codeOf(dr.unmerge(ctx, s.id, { reason: 'wrong person', confirm: false }, audit))).toEqual({ code: 'CUSTOMER_UNMERGE_CONFIRM_REQUIRED', status: 400 });
    const out = await dr.unmerge(ctx, s.id, { reason: 'Two different people with one phone', confirm: true }, audit);
    expect(out).toMatchObject({ survivorId: P, restoredCustomerIds: [D], pointsRestored: 40 });
    expect(out.restored.tickets).toBe(2); expect(out.restored.gift_cards).toBe(1);
    expect((await q(sql`select status, archived_at from customers where id = ${D}`))[0]).toMatchObject({ status: 'active', archived_at: null });
    expect((await q(sql`select customer_id from tickets where id = any(${[id('d1'), id('d2')]}::uuid[])`)).every((r) => r.customer_id === D)).toBe(true);
    expect((await q(sql`select customer_id from tickets where id = ${id('d9')}`))[0].customer_id).toBe(P);
    expect((await q(sql`select customer_id from gift_cards where code = 'C08-GC-D'`))[0].customer_id).toBe(D);
    expect((await q(sql`select tag from customer_tags where customer_id = ${D} order by tag`)).map((r) => r.tag)).toEqual(['late', 'vip']);
    expect((await q(sql`select tag from customer_tags where customer_id = ${P}`)).map((r) => r.tag)).toEqual(['vip']);
    const lp = async (c: string) => (await q(sql`select points_balance::int p, total_earned_points::int e from customer_loyalty_profiles where customer_id = ${c}`))[0];
    expect(await lp(D)).toEqual({ p: 40, e: 60 }); expect(await lp(P)).toEqual({ p: 100, e: 100 });
    expect((await q(sql`select coalesce(sum(delta),0)::int n from loyalty_ledger where tenant_id = ${T}`))[0].n).toBe(0);   // the pairs net out
    expect((await snapOf(P)).status).toBe('undone');
    expect((await q(sql`select action, resource_id, metadata from audit_events where action = 'customer.unmerged'`))[0]).toMatchObject({ resource_id: s.id });
    expect(await codeOf(dr.unmerge(ctx, s.id, { reason: 'again', confirm: true }, audit))).toEqual({ code: 'CUSTOMER_UNMERGE_ALREADY_UNDONE', status: 409 });
    const page = await dr.merges(ctx, { status: 'undone' });
    expect(page.items[0]).toMatchObject({ id: s.id, status: 'undone', undoneBy: 'Owner Kim', undoReason: 'Two different people with one phone' });
  });

  it('a moved row touched since the merge → refused (ROWS_CHANGED), nothing restored', async () => {
    await merge(E, F);
    const s = await snapOf(E);
    await sql`update tickets set total_cents = 4600 where id = ${id('d3')}`.execute(db);
    expect(await dr.unmergeCheck(ctx, s.id)).toMatchObject({ ok: false, code: 'CUSTOMER_UNMERGE_ROWS_CHANGED', details: { changed: { tickets: 1 } } });
    expect(await codeOf(dr.unmerge(ctx, s.id, { reason: 'try anyway', confirm: true }, audit))).toEqual({ code: 'CUSTOMER_UNMERGE_ROWS_CHANGED', status: 409 });
    expect((await q(sql`select status from customers where id = ${F}`))[0].status).toBe('archived');
    expect((await q(sql`select customer_id from tickets where id = ${id('d3')}`))[0].customer_id).toBe(E);
    expect((await snapOf(E)).status).toBe('active');
  });

  it('a loyalty entry after the merge → refused (LOYALTY_CHANGED)', async () => {
    await merge(G, H);
    const s = await snapOf(G);
    await db.transaction().execute((trx) => applyLoyaltyEntry(trx, { tenantId: T, branchId: B, customerId: G, entryType: 'redeem', delta: -20, reason: 'used points' }));
    expect(await codeOf(dr.unmerge(ctx, s.id, { reason: 'try', confirm: true }, audit))).toEqual({ code: 'CUSTOMER_UNMERGE_LOYALTY_CHANGED', status: 409 });
    expect((await q(sql`select status from customers where id = ${H}`))[0].status).toBe('archived');
  });

  it('another salon cannot see or undo the merge; the snapshot cannot be edited or deleted', async () => {
    const s = await snapOf(G);
    const other = { ...ctx, tenantId: T2, branchId: B2 };
    expect(await codeOf(dr.unmergeCheck(other, s.id))).toEqual({ code: 'CUSTOMER_UNMERGE_NOT_FOUND', status: 404 });
    expect(await codeOf(dr.unmerge(other, s.id, { reason: 'x y z', confirm: true }, audit))).toEqual({ code: 'CUSTOMER_UNMERGE_NOT_FOUND', status: 404 });
    expect((await dr.merges(other, {})).total).toBe(0);
    await expect(sql`delete from customer_merge_snapshots where id = ${s.id}`.execute(db)).rejects.toThrow(/never deleted/);
    await expect(sql`update customer_merge_snapshots set snapshot = '{}'::jsonb where id = ${s.id}`.execute(db)).rejects.toThrow(/only change allowed/);
  });
});
