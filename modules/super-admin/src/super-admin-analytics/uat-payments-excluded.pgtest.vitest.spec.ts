// uat-payments-excluded.pgtest — Fiserv master build §12.7 / §14 (migration 840): a card charge on a NON-production
// merchant is test-only, marked by the database itself, and never counted in platform money totals. Cash, gift cards and
// a card recorded from an outside terminal are real money and stay counted. Production merchants are never marked.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyAnalyticsGapRepo } from './super-admin-analytics.kysely.repository';
import { KyselyAppointmentOversightGapRepo } from '../super-admin-appointment-oversight/super-admin-appointment-oversight.kysely.repository';

const T_UAT = 'f5aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', T_LIVE = 'f6aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_UAT = 'f5111111-1111-4111-8111-111111111111', B_LIVE = 'f6111111-1111-4111-8111-111111111111', B_LIVE_UAT = 'f6222222-1111-4111-8111-111111111111';
let pg: any; let db: any;
const q = async (s: string, p: any[] = []) => (await pg.query(s, p)).rows as any[];
async function pay(tenant: string, branch: string, method: string, processor: string | null, cents: number): Promise<string> {
  const cust = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,'T','C','T C') returning id`, [tenant, branch]))[0].id;
  const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values ($1,$2,$3,'paid',$4,0,0,$4) returning id`, [tenant, branch, cust, cents]))[0].id;
  return (await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, change_due_cents, status, processor, approved_at)
    values ($1,$2,$3,$4,$5,0,0,0,0,'approved',$6, now()) returning id`, [tenant, branch, tk, method, cents, processor]))[0].id;
}
const isTest = async (id: string) => (await q(`select is_test from payments where id = $1`, [id]))[0].is_test;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'U','UAT Salon','uat-salon','UATSAL','active'), ($2,'L','Live Salon','live-salon','LIVSAL','active')`, [T_UAT, T_LIVE]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'UAT','active'), ($3,$4,'Live','active'), ($5,$4,'Live but its own UAT MID','active')`, [B_UAT, T_UAT, B_LIVE, T_LIVE, B_LIVE_UAT]);
  await q(`insert into tenant_payment_config (tenant_id, processor, status, environment, merchant_id) values ($1,'fiserv','active','sandbox','MID-U'), ($2,'fiserv','active','production','MID-L')`, [T_UAT, T_LIVE]);
  await q(`insert into payment_merchant_accounts (tenant_id, branch_id, processor, merchant_id, status, environment) values ($1,$2,'fiserv','MID-LB','active','sandbox')`, [T_LIVE, B_LIVE_UAT]);
}, 180000);

describe('migration 840 — UAT card payments are test-only', () => {
  it('marks a processor card charge on a sandbox merchant; never cash, gift card or an outside-terminal card', async () => {
    expect(await isTest(await pay(T_UAT, B_UAT, 'card', 'cardpointe', 100012))).toBe(true);
    expect(await isTest(await pay(T_UAT, B_UAT, 'card', 'sandbox', 932))).toBe(true);
    expect(await isTest(await pay(T_UAT, B_UAT, 'cash', null, 2000))).toBe(false);
    expect(await isTest(await pay(T_UAT, B_UAT, 'gift_card', null, 1500))).toBe(false);
    expect(await isTest(await pay(T_UAT, B_UAT, 'card', 'none', 3000))).toBe(false);
  });

  it('a production merchant is never marked; a branch with its OWN sandbox merchant is, even in a live salon', async () => {
    expect(await isTest(await pay(T_LIVE, B_LIVE, 'card', 'cardpointe', 5000))).toBe(false);
    expect(await isTest(await pay(T_LIVE, B_LIVE_UAT, 'card', 'cardpointe', 7000))).toBe(true);
  });

  it('platform money totals leave the test charges out', async () => {
    // UAT salon: real = cash 2000 + gift 1500 + outside card 3000 = 6500 (the 100012 + 932 UAT charges are excluded)
    expect(await new KyselyAppointmentOversightGapRepo(db).todayRevenueCents(T_UAT)).toBe(6500);
    // live salon: 5000 real; the 7000 on its UAT branch merchant is excluded
    expect(await new KyselyAppointmentOversightGapRepo(db).todayRevenueCents(T_LIVE)).toBe(5000);
    const series = await new KyselyAnalyticsGapRepo(db).dailySeries(T_UAT, 1);
    expect(series.reduce((a: number, p: any) => a + Number(p.revenueCents ?? p.cents ?? 0), 0)).toBe(6500);
  });
});
