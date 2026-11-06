// customer-directory-sql.pgtest — F1 §58 / §62 (Nov 5 2026): the directory computed in Postgres gives EXACTLY what the
// previous in-memory implementation gave, on a seeded salon that exercises every rule (0 / 1 / 2 / 5 / 9 visits, refunds,
// tiers + VIP, archived, duplicate phone / e-mail / name, birthdays, opt-ins, idle ranges, two locations
// profiles, another salon). Then: tags — which the old path never read — now filter and tally.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const P = 'f1d5e000-0000-4000-8000-0000000';
const id = (n: string | number) => P + String(n).padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b3');
const owner = { tenantId: T, branchId: null, userId: id('e1'), role: 'OWNER', permissions: ['pos.customers.view'] } as any;
const atB2 = { ...owner, branchId: B2 };
let pg: any; let repo: KyselyCustomersRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const DAY = 86_400_000;

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Dir LLC','Dir','cust-dir','CDR001','active'), ($2,'Oth LLC','Oth','cust-dir2','CDR002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Second','active','America/New_York'), ($4,$5,'X','active','America/New_York')`, [B, T, B2, BX, T2]);
  const now = Date.now();
  // 60 customers; every property cycles on its own period so the combinations vary. Times sit at half days (no boundary flips).
  for (let i = 1; i <= 60; i++) {
    const branch = i % 3 === 0 ? B2 : B;
    const first = i % 11 === 0 ? 'Twin' : ['Nguyễn', 'Anna', 'Bích', 'Lan', 'Mai', 'Đào'][i % 6] + i;
    const last = i % 11 === 0 ? 'Same' : 'Trần';
    const phone = i % 13 === 0 ? '(215) 555-0013' : `+1215555${String(1000 + i)}`;
    const email = i % 17 === 0 ? 'shared@x.test' : `c${i}@x.test`;
    const status = i % 19 === 0 ? 'archived' : i % 23 === 0 ? 'inactive' : 'active';
    const birthday = i % 4 === 0 ? `19${70 + (i % 30)}-${String((i % 12) + 1).padStart(2, '0')}-15` : null;
    const created = new Date(now - ((i * 9) % 140 + 0.5) * DAY).toISOString();
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, email, status, birthday, marketing_sms_opt_in, marketing_email_opt_in, created_at)
      values ($1,$2,$3,$4,$5,$4 || ' ' || $5,$6,$6,$7,$8,$9,$10,$11,$12)`, [id(i), T, branch, first, last, phone, email, status, birthday, i % 5 === 0, i % 8 === 0, created]);
    const visits = [0, 1, 2, 5, 9][i % 5];
    for (let v = 0; v < visits; v++) {
      const at = new Date(now - ((i * 7 + v * 31) % 200 + 0.5) * DAY).toISOString();
      await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [id(10000 + i * 10 + v), T, branch ?? B, id(i), v % 4 === 3 ? 'paid' : 'closed', 2500 + i * 37 + v * 100, String(70000 + i * 10 + v), at]);
    }
    if (visits && i % 6 === 0) {   // a completed refund on one of the visits
      await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'card',2000,'approved')`, [id(30000 + i), T, branch ?? B, id(10000 + i * 10)]);
      await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status) values ($1,$2,$3,700,'refunded')`, [T, branch ?? B, id(30000 + i)]);
    }
    if (i % 4 === 1) await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, vip_since) values ($1,$2,$3,$4,$5,$6)`,
      [T, branch ?? B, id(i), ['Regular', 'Gold', 'VIP Silver', 'Silver'][i % 4 === 1 ? (i / 4) % 4 | 0 : 0], i % 3 ? 120 : 0, i % 9 === 1 ? new Date(now - 30 * DAY).toISOString() : null]);
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, email) values ($1,$2,$3,'Stranger','Trần','Stranger Trần','+12155551013','+12155551013','c1@x.test')`, [id(99), T2, BX]);
  repo = new KyselyCustomersRepository(kyselyFor(pg) as never);
}, 240_000);

const ids = (st: any) => (st.rows.items as any[]).map((r) => r.customerId).sort();
const shape = (st: any) => ({ total: st.rows.pagination.totalItems, segmentCounts: st.segmentCounts, kpisFull: st.kpisFull, kpis: st.kpis, analytics: st.analytics,
  sources: st.directory.sources, topSpenders: st.directory.topSpendersCount, tiers: [...st.filterFacets.loyaltyTiers].sort(),
  dups: Object.fromEntries((st.rows.items as any[]).map((r) => [r.customerId, r.duplicateRisk])), spend: Object.fromEntries((st.rows.items as any[]).map((r) => [r.customerId, [r.visitCount, r.totalSpendCents, r.loyaltyTier, r.isVip, r.lastVisitAt]])) });

const FILTERS: Record<string, any>[] = [
  {}, { segment: 'never' }, { segment: 'new' }, { segment: 'returning' }, { segment: 'vip' }, { segment: 'at_risk' },
  { status: 'archived' }, { status: 'inactive' }, { loyaltyTier: 'Gold' }, { birthdayMonth: '5' }, { marketingOptIn: 'true' }, { marketingOptIn: 'false' },
  { inactiveDays: 60 }, { duplicateRisk: 'high' }, { duplicateRisk: 'possible' }, { search: 'nguyen' }, { search: 'TRẦN' }, { search: '555-0013' }, { search: 'shared@' },
  { search: 'twin same' }, { search: '%' }, { source: 'walk_in' }, { segment: 'returning', marketingOptIn: 'true' }, { segment: 'at_risk', search: 'anna' },
];

describe('F1 §58/§62 — the SQL directory equals the in-memory one', () => {
  for (const f of FILTERS) {
    it(`owner, all locations: ${JSON.stringify(f)}`, async () => {
      const [a, b] = await Promise.all([repo.query(owner, { ...f, pageSize: 100 }), repo.queryInMemory(owner, { ...f, pageSize: 100 })]);
      expect(ids(a)).toEqual(ids(b));
      expect(shape(a)).toEqual(shape(b));
    }, 60_000);
  }
  it('a location (Second) — its own profiles, never the other location\'s or another salon\'s', async () => {
    for (const f of [{}, { segment: 'returning' }, { search: 'trần' }, { duplicateRisk: 'high' }]) {
      const [a, b] = await Promise.all([repo.query(atB2, { ...f, pageSize: 100 }), repo.queryInMemory(atB2, { ...f, pageSize: 100 })]);
      expect(ids(a)).toEqual(ids(b)); expect(shape(a)).toEqual(shape(b));
      expect(ids(a)).not.toContain(id(99));
    }
  }, 120_000);
  it('paging is in SQL: pages of 7 cover the matched set exactly once, in a stable order', async () => {
    const seen: string[] = [];
    const first = await repo.query(owner, { pageSize: 7, page: 1 });
    for (let p = 1; p <= first.rows.pagination.totalPages; p++) seen.push(...(await repo.query(owner, { pageSize: 7, page: p })).rows.items.map((r: any) => r.customerId));
    expect(seen).toHaveLength(first.rows.pagination.totalItems);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(ids(await repo.queryInMemory(owner, { pageSize: 100 })));
  }, 120_000);
  it('fixed on the way: tags are read (the old path always had none) — the Tags card, the tag filter and search see them', async () => {
    await q(`insert into customer_tags (tenant_id, branch_id, customer_id, tag) values ($1,$2,$3,'Allergic to acetone'), ($1,$2,$4,'Allergic to acetone'), ($1,$2,$4,'Prefers Mai')`, [T, B, id(1), id(2)]);
    const st = await repo.query(owner, {});
    expect(st.directory.topTags).toEqual([{ name: 'Allergic to acetone', count: 2 }, { name: 'Prefers Mai', count: 1 }]);
    expect(ids(await repo.query(owner, { tag: 'Prefers Mai' }))).toEqual([id(2)]);
    expect(ids(await repo.query(owner, { search: 'acetone' }))).toEqual([id(1), id(2)].sort());
    expect((await repo.queryInMemory(owner, { tag: 'Prefers Mai' })).rows.items).toEqual([]);   // what it used to answer
  }, 60_000);
});
