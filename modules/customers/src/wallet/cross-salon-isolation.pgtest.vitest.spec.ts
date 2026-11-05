// cross-salon-isolation.pgtest — Nov 5 2026 (check:tenant / check:tenant-builder findings): one person can be a customer
// at two salons. The wallet must find THIS salon's customer row and only its ledger; a referral code only counts at the
// salon that issued it (the POS lookup must not show another salon's customer name).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyWalletLedgerRepository } from './wallet.kysely.repository';
import { KyselyReferralsRepository } from '../pos-referrals/pos-referrals.kysely.repository';

const TA = 'e7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TB = 'e8aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BA = 'e7111111-1111-4111-8111-111111111111', BB = 'e8111111-1111-4111-8111-111111111111';
const USER = 'e9999999-9999-4999-8999-999999999999';
let pg: any; let db: any; let custA = ''; let custB = '';
const q = async (s: string, p: any[] = []) => (await pg.query(s, p)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','salon-a-x','SALONA','active'), ($2,'B','Salon B','salon-b-x','SALONB','active')`, [TA, TB]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'A','active'), ($3,$4,'B','active')`, [BA, TA, BB, TB]);
  await q(`insert into users (id, tenant_id, email, password_hash, role, status) values ($1, null, 'mai@example.test', 'x', 'CUSTOMER', 'active')`, [USER]);
  // the same person (one login) is a customer at BOTH salons — salon B's row is created first, so an unscoped lookup finds it
  custB = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, user_id) values ($1,$2,'Mai','Tran','Mai at B',$3) returning id`, [TB, BB, USER]))[0].id;
  custA = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, user_id) values ($1,$2,'Mai','Tran','Mai at A',$3) returning id`, [TA, BA, USER]))[0].id;
  await q(`insert into customer_wallet_ledger (tenant_id, customer_id, amount_cents, entry_type, currency) values ($1,$2,5000,'top_up','USD'), ($3,$4,700,'top_up','USD')`, [TB, custB, TA, custA]);
  await q(`insert into customer_referrals (tenant_id, customer_id, code) values ($1,$2,'MAIB-REF')`, [TB, custB]);
}, 180000);

describe('cross-salon isolation', () => {
  it('the wallet resolves THIS salon\'s customer and shows only this salon\'s ledger', async () => {
    const w = new KyselyWalletLedgerRepository(db);
    expect(await w.resolveCustomerId(TA, USER)).toBe(custA);
    expect(await w.balance(TA, custA)).toBe(700);
    expect(await w.balance(TA, custB)).toBe(0);                       // salon B's money is invisible from salon A
    expect((await w.transactions(TA, custB, 10))).toEqual([]);
    expect((await w.transactions(TA, custA, 10)).map((e) => e.amountCents)).toEqual([700]);
  });

  it('a referral code only resolves at the salon that issued it', async () => {
    const r = new KyselyReferralsRepository(db);
    expect(await r.findCodeOwner({ tenantId: TB } as any, 'maib-ref')).toEqual({ customerId: custB, customerName: 'Mai at B' });
    expect(await r.findCodeOwner({ tenantId: TA } as any, 'MAIB-REF')).toBeNull();   // no other salon's customer name leaks
  });
});
