// rewards-explainer.pgtest — Extras · GLOBAL LOYALTY 05 on the REAL schema: the customer's own earning history says where the
// points came from, since when they were spendable and which rule version applied (network rate or the salon's own rate),
// from the snapshot stored at earn time.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { customerRewards } from './rewards-apps';

const P = 'd7350000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), BA = id('b1'), BB = id('b2'), IDV = id('f1'), USER_A = id('7a1'), CA = id('c1'), CB = id('c2');
let pg: any; let db: any;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','rx-a','RXA001','active'), ($2,'B','Salon B','rx-b','RXB001','active')`, [TA, TB]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'A','America/New_York'), ($3,$4,'B','America/New_York')`, [BA, TA, BB, TB]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Ava','Kim','Ava Kim','active'), ($4,$5,$6,'Ava','Kim','Ava Kim','active')`, [CA, TA, BA, CB, TB, BB]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Ava Kim','ava@rx.test','active','CUSTOMER')`, [USER_A, TA]);
  await q(`insert into customer_identities (id, normalized_phone, full_name, status, phone_verified_at) values ($1,'+16095550142','Ava Kim','active',now())`, [IDV]);
  await q(`insert into customer_identity_links (identity_id, tenant_id, user_id, customer_id) values ($1,$2,$3,$4)`, [IDV, TA, USER_A, CA]);
  await q(`insert into global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source, available_tenths) values ($1,'2026-10-30','customer_app',now(),'customer_app',1500)`, [IDV]);
});

describe('customerRewards earned → rule version + spendable since', () => {
  it('network-rate and salon-rate earnings name their version; a fully refunded earning is not spendable', async () => {
    const gv = (await q(`select id, version_no from global_earning_rule_versions order by version_no limit 1`))[0];
    const tv = (await q(`insert into tenant_earning_policy_versions (tenant_id, version_no, mode, spend_increment_cents, point_tenths_per_increment, status, effective_from)
      values ($1, 3, 'CUSTOM', 500, 10, 'ACTIVATED', now() - interval '10 days') returning id`, [TB]))[0];
    const earn = (t: string, b: string, c: string, src: string, ver: string, status: string, at: string, rev = 0) => q(`insert into reward_earn_transactions (tenant_id, branch_id, ticket_id, customer_id, identity_id, effective_at,
        eligible_cents, rule_source, rule_version_id, spend_increment_cents, point_tenths_per_increment, point_tenths, backing_cents, status, reversed_tenths, created_at)
      values ($1,$2,gen_random_uuid(),$3,$4,$8::timestamptz,10000,$5,$6,500,10,200,1000,$7,$9,$8::timestamptz)`, [t, b, c, IDV, src, ver, status, at, rev]);
    await earn(TA, BA, CA, 'GLOBAL_DEFAULT', gv.id, 'EARNED', '2026-11-01T15:00:00Z');
    await earn(TB, BB, CB, 'TENANT_OVERRIDE', tv.id, 'EARNED', '2026-11-03T15:00:00Z');
    await earn(TB, BB, CB, 'TENANT_OVERRIDE', tv.id, 'REVERSED', '2026-11-02T15:00:00Z', 200);
    const r: any = await customerRewards(db, { tenantId: TA, userId: USER_A, role: 'CUSTOMER' });
    expect(r.earned.map((e: any) => [e.salon, e.rule, e.spendableFrom, e.status])).toEqual([
      ['Salon B', { kind: 'salon', versionNo: 3 }, '2026-11-03T15:00:00.000Z', 'EARNED'],
      ['Salon B', { kind: 'salon', versionNo: 3 }, null, 'REVERSED'],
      ['Salon A', { kind: 'network', versionNo: Number(gv.version_no) }, '2026-11-01T15:00:00.000Z', 'EARNED'],
    ]);
  });
});
