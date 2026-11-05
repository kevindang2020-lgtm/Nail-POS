// checkout-local-day.pgtest — the POS Checkout screen's "today" is the BRANCH's day, not the database's UTC day (Oct 6 2026).
//
// The clock is fixed at 9:30 pm Monday Oct 5 in New York (01:30 UTC Tuesday). Each figure gets one row from 10 am this
// New York day and one from 11 pm the night before (which is Monday in UTC) and must count exactly the first: a UTC day
// counts neither (it is already Tuesday there) and too wide a window counts both.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CashDrawerRepository } from '../cash-drawer/cash-drawer.repository';
import { CashDrawerService } from '../cash-drawer/cash-drawer.service';
import { normDate } from '../cash-drawer/cash-drawer.dto';

const T = 'cdcdcdcd-0000-4000-8000-000000000001';
const B = 'cdcdcdcd-0000-4000-8000-000000000002';
const C = 'cdcdcdcd-0000-4000-8000-000000000003';
const TK1 = 'cdcdcdcd-0000-4000-8000-000000000010';
const TK2 = 'cdcdcdcd-0000-4000-8000-000000000011';
const GC = 'cdcdcdcd-0000-4000-8000-000000000020';
const NOW = Date.parse('2026-10-06T01:30:00Z');
const TEN_AM = '2026-10-05T14:00:00Z', ELEVEN_PM_SUN = '2026-10-05T03:00:00Z';
const ctx: any = { tenantId: T, branchId: B, userId: 'cdcdcdcd-0000-4000-8000-0000000000c1', role: 'OWNER', permissions: ['pos.checkout.view'] };
let repo: KyselyCheckoutRepository; let drawer: CashDrawerRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite(); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Checkout Day LLC','Checkout Day','checkout-day','CDAY01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Day','Guest','Day Guest')`, [C, T, B]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$3,$4,$5,'paid',$6), ($2,$3,$4,$5,'paid',$7)`, [TK1, TK2, T, B, C, TEN_AM, ELEVEN_PM_SUN]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values ($1,$2,$3,'cash',5500,500,'approved',$5), ($1,$2,$4,'cash',9900,700,'approved',$6), ($1,$2,$3,'card',100,0,'declined',$5), ($1,$2,$4,'card',100,0,'declined',$6)`, [T, B, TK1, TK2, TEN_AM, ELEVEN_PM_SUN]);
  await q(`insert into gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status) values ($1,$2,'GC-LOCAL-DAY',10000,7000,'active')`, [GC, T]);
  await q(`insert into gift_card_transactions (tenant_id, gift_card_id, type, amount_cents, balance_after_cents, created_at) values ($1,$2,'redeem',1000,9000,$3), ($1,$2,'redeem',2000,7000,$4)`, [T, GC, TEN_AM, ELEVEN_PM_SUN]);
  // cash taken tonight at 9 pm (Tuesday in UTC) and last night at 11 pm (Monday in UTC)
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values ($1,$2,$3,'cash',3000,0,'approved','2026-10-06T01:00:00Z')`, [T, B, TK1]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values ($1,$2,$3,'cash',800,0,'refunded','2026-10-06T01:10:00Z')`, [T, B, TK1]);
  repo = new KyselyCheckoutRepository(kyselyFor(pg) as never); repo.now = () => NOW;
  drawer = new CashDrawerRepository(kyselyFor(pg) as never); drawer.now = () => NOW;
});

describe('Checkout counts the branch\'s day', () => {
  it('tips, paid tickets and failed payments today: the 10 am rows only', async () => {
    const r: any = await repo.query(ctx, {} as never);
    expect(r.kpisFull.tipsTodayCents).toBe(500);
    expect(r.kpisFull.paidTicketsToday).toBe(1);
    expect(r.kpisFull.failedPaymentsToday).toBe(1);
  });
  it('gift card redemptions today: $10 — not $0 (UTC "tomorrow"), not $30 (last night too)', async () => {
    const r: any = await repo.query(ctx, {} as never);
    expect(r.kpisFull.giftCardLoyaltyRedemptionsCents).toBe(1000);
  });
});

describe('the cash drawer is the branch\'s business day', () => {
  it('opens on Monday at 9:30 pm — not Tuesday (the UTC date)', async () => {
    expect(await drawer.today(ctx)).toBe('2026-10-05');
    expect(normDate(undefined, await drawer.today(ctx))).toBe('2026-10-05');
    expect(normDate('2026-10-01', await drawer.today(ctx))).toBe('2026-10-01');   // a date the front desk picked stands
  });
  it('Monday\'s register cash: 10 am $55 + 9 pm $30, less the 9:10 pm $8 refund — last night\'s $99 is Sunday\'s', async () => {
    expect(await drawer.computeRegisterCash(ctx, B, '2026-10-05')).toEqual({ salesCents: 8500, refundsCents: 800, paymentCount: 2 });
    expect((await drawer.computeRegisterCash(ctx, B, '2026-10-04')).salesCents).toBe(9900);
  });
  it('the service\'s default date is the branch\'s, so tonight\'s count is reconciled against tonight\'s cash', async () => {
    const svc = new CashDrawerService(drawer);
    const st: any = await svc.getDrawer({ ...ctx, permissions: ['pos.checkout.take_payment'] });
    expect(st.businessDate).toBe('2026-10-05');
  });
});
