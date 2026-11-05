// customer-directory-f1.pgtest.vitest.spec.ts — Customer Directory mandate F1 §37 / §39 (Nov 5 2026).
//
// §37 Retention Trend: month-by-month figures come from the nightly retention snapshots (last completed day of each
//     month, Active ÷ customers who have visited). A month with no completed snapshot is a gap (null), never an estimate;
//     a location view of a month computed before locations were recorded is also a gap ('no_branch_data').
// §39 Recent Customer Activity: built from the whole salon (latest visits + profiles added in the last 30 days), not the
//     rows on the current page, and never from another salon.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const P = 'f1d1e000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b3');
const ctx = { tenantId: T, branchId: null, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view'] } as any;
let pg: any; let repo: KyselyCustomersRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const monthOf = (offset: number) => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - offset, 1)).toISOString().slice(0, 7); };

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'F1 LLC','F1','cust-f1','CF1001','active'), ($2,'Other LLC','Other','cust-f1o','CF1002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Second','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B2, BX, T2]);
  const cust = (cid: string, tenant: string, branch: string, name: string, daysOld: number) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, created_at) values ($1,$2,$3,$4,'X',$4 || ' X', now() - ($5::int * interval '1 day'))`, [cid, tenant, branch, name, daysOld]);
  // 10 customers in the salon — more than one page of 3 — plus one in another salon
  for (let i = 1; i <= 10; i++) await cust(id('c' + i), T, B, 'Cust' + i, 200);
  await cust(id('c11'), T, B, 'Newbie', 2);                     // added 2 days ago, no visit
  await cust(id('c99'), T2, BX, 'Stranger', 1);                 // other salon
  // visits: Cust10 most recent (1 day ago) … Cust1 oldest
  for (let i = 1; i <= 10; i++) {
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at) values ($1,$2,$3,$4,'closed',3000,$5, now() - ($6::int * interval '1 day'), now() - ($6::int * interval '1 day'))`,
      [id('d' + i), T, B, id('c' + i), String(91000 + i), 40 - i * 3 + 1]);
  }
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at) values ($1,$2,$3,$4,'closed',3000,'99001', now(), now())`, [id('d99'), T2, BX, id('c99')]);

  // snapshots: last month complete (has_branch), two months ago computed before locations were recorded, none earlier
  const run = async (rid: string, date: string, hasBranch: boolean, segs: [string, string, string | null][]) => {
    await q(`insert into customer_retention_snapshot_runs (id, tenant_id, snapshot_local_date, definition_version, settings_version, segmentation_version, risk_days, approaching_days, time_zone, kind, status, coverage, has_branch)
      values ($1,$2,$3::date,'v1+s1',1,'v1',60,45,'America/New_York','nightly','completed','complete',$4)`, [rid, T, date, hasBranch]);
    for (const [cid, seg, br] of segs) await q(`insert into customer_retention_daily_snapshots (tenant_id, customer_id, snapshot_local_date, definition_version, settings_version, segment, data_quality, run_id, last_visit_branch_id) values ($1,$2,$3::date,'v1+s1',1,$4,'complete',$5,$6)`, [T, cid, date, seg, rid, br]);
  };
  const m1 = monthOf(1), m2 = monthOf(2);
  // last month: 3 active (2 at Main, 1 at Second), 1 at risk, 1 never visited → 3/4 = 75%; Main only → 2/3 = 66.7%
  await run(id('e1'), `${m1}-15`, true, [[id('c1'), 'active', B], [id('c2'), 'active', B], [id('c3'), 'active', B2], [id('c4'), 'at_risk', B], [id('c5'), 'never_visited', null]]);
  await run(id('e2'), `${m2}-20`, false, [[id('c1'), 'active', null], [id('c2'), 'approaching', null]]);
  repo = new KyselyCustomersRepository(kyselyFor(pg) as never);
});

describe('F1 Customer Directory — retention trend from snapshots (§37)', () => {
  it('returns the last 6 months oldest first; a month with a completed snapshot gets Active ÷ visited, the rest are gaps', async () => {
    const st = await repo.query(ctx, {});
    const s = st.retentionSeries!;
    expect(s.map((m) => m.month)).toEqual([5, 4, 3, 2, 1, 0].map(monthOf));
    expect(s[4]).toEqual({ month: monthOf(1), date: `${monthOf(1)}-15`, ratePercent: 75, reason: null });
    expect(s[3]).toEqual({ month: monthOf(2), date: `${monthOf(2)}-20`, ratePercent: 50, reason: null });
    for (const i of [0, 1, 2, 5]) expect(s[i]).toMatchObject({ ratePercent: null, reason: 'missing' });
  });
  it('a location view counts only that location, and a month without recorded locations is a gap, not the salon figure', async () => {
    const st = await repo.query({ ...ctx, branchId: B }, {});
    const s = st.retentionSeries!;
    expect(s[4].ratePercent).toBe(66.7);
    expect(s[3]).toMatchObject({ ratePercent: null, reason: 'no_branch_data' });
  });
  it('another salon sees no months from this salon', async () => {
    const st = await repo.query({ ...ctx, tenantId: T2 }, {});
    expect(st.retentionSeries!.every((m) => m.ratePercent === null)).toBe(true);
  });
});

describe('F1 Customer Directory — recent activity is the whole salon, not the page (§39)', () => {
  it('page 4 of size 3 still lists the salon’s latest visits and new profiles, newest first, never another salon', async () => {
    const st = await repo.query(ctx, { page: 4, pageSize: 3 });
    expect(st.rows.items.length).toBeLessThanOrEqual(3);
    const act = st.recentActivity!;
    expect(act.length).toBe(8);
    expect(act[0]).toMatchObject({ customerId: id('c11'), kind: 'added' });
    const visits = act.filter((a) => a.kind === 'visit').map((a) => a.customerId);
    expect(visits.slice(0, 3)).toEqual([id('c10'), id('c9'), id('c8')]);
    expect(act.some((a) => a.customerId === id('c99'))).toBe(false);
    const times = act.map((a) => new Date(a.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
