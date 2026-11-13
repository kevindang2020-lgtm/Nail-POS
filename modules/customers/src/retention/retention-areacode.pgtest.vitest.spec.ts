// retention-areacode.pgtest — Customer Retention & Win-Back §01/§02/§07: the Area Code finder.
//   856 finds every stored +1 856 number of THIS salon (across pages), never another salon's, never a number that only
//   contains 856 later in the digits; it combines with the inactivity filter; a malformed code is refused (not ignored);
//   "select all matching" for the bulk SMS preview resolves against the same area code.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionRepository, RetentionError, areaCodeOf } from './retention.repository';
import { RetentionSmsService } from './retention-sms.service';

const P = 'c5e85600-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2');
// A1..A3 have 856 numbers (A3 never visited) · M1 has 856 inside the digits but area code 215 · NP no phone · X1 another salon's 856
const [A1, A2, A3, M1, NP, X1] = ['c01', 'c02', 'c03', 'c04', 'c05', 'c99'].map(id);
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view'], salonName: 'Lotus Nails' };
let pg: any; let repo: RetentionRepository; let svc: RetentionSmsService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof RetentionError ? e.code : String((e as Error).message); } }

beforeAll(async () => {
  pg = await migratedPglite(); const db = kyselyFor(pg);
  repo = new RetentionRepository(db); svc = new RetentionSmsService(db, repo, null);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','ac-lotus','AC0001','active'), ($2,'Other LLC','Other Nails','ac-other','AC0002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Alpha','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  const cust = (cid: string, tenant: string, branch: string, name: string, phone: string | null) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in, created_at) values ($1,$2,$3,$4,'X',$4,$5,true, now() - interval '400 days')`, [cid, tenant, branch, name, phone]);
  await cust(A1, T, B, 'Anna', '+18565550101'); await cust(A2, T, B, 'Bea', '+18565550102'); await cust(A3, T, B, 'Cat', '+18565550103');
  await cust(M1, T, B, 'Mia', '+12158565501'); await cust(NP, T, B, 'Nell', null); await cust(X1, T2, B2, 'Xena', '+18565550199');
  let n = 0;
  const tk = async (tenant: string, branch: string, cid: string, daysAgo: number) => {
    const tid = id('d' + String(++n).padStart(3, '0'));
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
      values ($1,$2,$3,$4,'closed',4000,$5, now() - ($6::int * interval '1 day'), now() - ($6::int * interval '1 day'))`, [tid, tenant, branch, cid, String(70000 + n), daysAgo]);
  };
  await tk(T, B, A1, 100); await tk(T, B, A2, 20); await tk(T, B, M1, 100); await tk(T2, B2, X1, 100);
}, 240_000);

describe('Win-Back area code finder', () => {
  it('856 returns only this salon’s +1 856 numbers, across every page, with masked phones', async () => {
    const p1 = await repo.customers(ctx, { segment: 'all', areaCode: '856', pageSize: 2, page: 1 });
    const p2 = await repo.customers(ctx, { segment: 'all', areaCode: '856', pageSize: 2, page: 2 });
    expect(p1.totalItems).toBe(3); expect(p1.totalPages).toBe(2); expect(p1.filters.areaCode).toBe('856');
    const ids = [...p1.items, ...p2.items].map((r) => r.customerId).sort();
    expect(ids).toEqual([A1, A2, A3].sort());                 // not M1 (856 inside the digits), not X1 (another salon), not NP
    for (const r of [...p1.items, ...p2.items]) expect(r.maskedPhone).not.toContain('555010');
  });

  it('combines with the inactivity threshold and the segment (never visited is never "inactive")', async () => {
    const inactive = await repo.customers(ctx, { segment: 'all', areaCode: '856', minDays: 60, pageSize: 50 });
    expect(inactive.items.map((r) => r.customerId)).toEqual([A1]);
    const never = await repo.customers(ctx, { segment: 'never', areaCode: '856', pageSize: 50 });
    expect(never.items.map((r) => r.customerId)).toEqual([A3]);
  });

  it('a code with no stored numbers is an honest empty result; another salon never leaks in', async () => {
    const none = await repo.customers(ctx, { segment: 'all', areaCode: '609', pageSize: 50 });
    expect(none.totalItems).toBe(0); expect(none.items).toEqual([]);
    const other = await repo.customers({ ...ctx, tenantId: T2, branchId: B2 }, { segment: 'all', areaCode: '856', pageSize: 50 });
    expect(other.items.map((r) => r.customerId)).toEqual([X1]);
  });

  it('a malformed area code is refused, not silently ignored', async () => {
    expect(await code(repo.customers(ctx, { segment: 'all', areaCode: '85' }))).toBe('RETENTION_INVALID_FILTER');
    expect(await code(repo.customers(ctx, { segment: 'all', areaCode: '156' }))).toBe('RETENTION_INVALID_FILTER');
    expect(areaCodeOf('')).toBeNull(); expect(areaCodeOf(' 856 ')).toBe('856');
  });

  it('"select all matching" for the bulk SMS preview uses the same area code (no customer outside it)', async () => {
    const p = await svc.preview(ctx, { selection: { segment: 'all', areaCode: '856' }, body: 'We miss you! Book again.' });
    expect(p.selected).toBe(3);
    const ids = await repo.matchingIds(ctx, { segment: 'all', areaCode: '856' });
    expect(ids.sort()).toEqual([A1, A2, A3].sort());
  });
});

// extras Win-Back 10 — Phone Contact Verification: a confirmed number (customers.phone_verified_at) is shown and filterable
// as verified / unverified; verification never implies consent (no SMS opt-in stays no_consent) and changes no profile.
describe('Win-Back phone contact verification', () => {
  it('rows carry verified / unverified / no_number; the filter narrows to valid numbers; consent is not inferred', async () => {
    await q(`update customers set phone_verified_at = now() - interval '3 days' where id = any($1::uuid[])`, [[A1, A2]]);
    await q(`update customers set marketing_sms_opt_in = false where id = $1`, [A2]);   // verified, but never agreed to texts
    const before = (await q(`select id, full_name, normalized_phone, marketing_sms_opt_in, updated_at from customers where tenant_id = $1 order by id`, [T])).rows;
    const all = await repo.customers(ctx, { segment: 'all', pageSize: 50 });
    const by = Object.fromEntries(all.items.map((r) => [r.customerId, r]));
    expect(by[A1].phoneVerification).toBe('verified');
    expect(by[A2].phoneVerification).toBe('verified');
    expect(by[A2].smsStatus).toBe('no_consent');                 // verified is NOT consent
    expect(by[A3].phoneVerification).toBe('unverified');
    expect(by[NP].phoneVerification).toBe('no_number');
    const ver = await repo.customers(ctx, { segment: 'all', phoneCheck: 'verified', pageSize: 50 });
    expect(ver.items.map((r) => r.customerId).sort()).toEqual([A1, A2].sort()); expect(ver.filters.phoneCheck).toBe('verified');
    const unv = await repo.customers(ctx, { segment: 'all', phoneCheck: 'unverified', pageSize: 50 });
    expect(unv.items.map((r) => r.customerId).sort()).toEqual([A3, M1].sort());   // valid numbers only — NP (no phone) is neither
    const combo = await repo.customers(ctx, { segment: 'all', phoneCheck: 'verified', areaCode: '856', minDays: 60, pageSize: 50 });
    expect(combo.items.map((r) => r.customerId)).toEqual([A1]);
    const other = await repo.customers({ ...ctx, tenantId: T2, branchId: B2 }, { segment: 'all', phoneCheck: 'verified', pageSize: 50 });
    expect(other.items).toEqual([]);                              // another salon's list is never affected
    const after = (await q(`select id, full_name, normalized_phone, marketing_sms_opt_in, updated_at from customers where tenant_id = $1 order by id`, [T])).rows;
    expect(after).toEqual(before);                                // reading verification changes no profile
  });
});

describe('round 10 — Win-Back 11 (shared phone shown) · 13 (last visit technician offered to booking)', () => {
  it('a row names how many OTHER active profiles share its phone; the profiles stay apart; another salon never counts', async () => {
    const D1 = id('c61'), D2 = id('c62'), DX = id('c63');
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in) values ($1,$4,$5,'Dee','One','Dee One','+16095550777',true), ($2,$4,$5,'Dee','Two','Dee Two','+16095550777',true), ($3,$6,$7,'Dee','X','Dee X','+16095550777',true)`, [D1, D2, DX, T, B, T2, B2]);
    const r = await repo.customers(ctx, { segment: 'all', q: 'Dee', pageSize: 50 });
    const by = Object.fromEntries(r.items.map((i: any) => [i.customerId, i]));
    expect(by[D1].sharedPhoneProfiles).toBe(1); expect(by[D2].sharedPhoneProfiles).toBe(1);
    expect(r.items.filter((i: any) => i.customerId === D1 || i.customerId === D2)).toHaveLength(2);
    const nell = (await repo.customers(ctx, { segment: 'all', q: 'Nell', pageSize: 50 })).items[0] as any;
    expect(nell.sharedPhoneProfiles).toBe(0);                              // no phone: never "shared"
    await q(`update customers set archived_at = now() where id = $1`, [D2]);
    expect(((await repo.customers(ctx, { segment: 'all', q: 'Dee One', pageSize: 50 })).items[0] as any).sharedPhoneProfiles).toBe(0);
  });
  it('lastTechnician = the technician on the latest visit, only while still active; none for a never-visited customer', async () => {
    const TE1 = id('e71'), TE2 = id('e72');
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$3,$4,'Old','Tech','Old Tech',true), ($2,$3,$4,'New','Tech','New Tech',true)`, [TE1, TE2, T, B]);
    const tickets = (await q(`select id, created_at from tickets where tenant_id = $1 and customer_id = $2 order by created_at`, [T, A1])).rows;
    const older = id('d901');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at) values ($1,$2,$3,$4,'closed',4000,'79901', now() - interval '300 days', now() - interval '300 days')`, [older, T, B, A1]);
    const line = (tk: string, te: string) => q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,gen_random_uuid(),$4,'Gel',4000,45,4000)`, [T, B, tk, te]);
    await line(older, TE1); await line(tickets[tickets.length - 1].id, TE2);
    const get = async () => ((await repo.customers(ctx, { segment: 'all', q: 'Anna', pageSize: 50 })).items.find((i: any) => i.customerId === A1) as any).lastTechnician;
    expect(await get()).toEqual({ id: TE2, name: 'New Tech' });
    await q(`update technicians set archived_at = now() where id = $1`, [TE2]);
    expect(await get()).toEqual({ id: TE1, name: 'Old Tech' });           // the latest visit whose technician still works here
    expect(((await repo.customers(ctx, { segment: 'all', q: 'Cat', pageSize: 50 })).items[0] as any).lastTechnician).toBeNull();
  });
});
