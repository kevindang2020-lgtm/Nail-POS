// promo-extra.mjs — Marketing → Promotions in the catalog harness (Promotions Management guide, Oct 30 2026): the REAL
// PromotionsCenterController (logged check / Eligibility Checks / trends / assistant safety / activity) over the seeded TEST
// database, beside the Discounts read model (extra.mjs) and the Deals / Coupons controllers (cp-extra.mjs) it reuses. The
// screenshot record "vishal" (20 %, code ending NG20) is cp-extra's seed — never re-created or altered here.
// Controls (GET /__promo?…):
//   state=1    DB truth: vishal rows / codes / status, redemptions by status, logged checks, drafts, assistant rows, campaigns
//              that left draft, notifications (nothing may be sent)
//   redeem=1   one TEST visit exactly as Checkout runs it: a paid $100 ticket for Promo Tester, vishal applied by its code
//              (candidate → priceTicket → reserve) and the payment step (onPaid) — twice, like a replayed callback
//   many=N     N extra draft promotions (pagination fixtures; never live)
// Tooling only; nothing is sent or charged.
import { KyselyDealsRepository } from '../../modules/deals/src/deals/deals.kysely.repository.ts';
import { DealsService } from '../../modules/deals/src/deals/deals.service.ts';
import { DealsCheckoutService } from '../../modules/deals/src/engine/deals-checkout.service.ts';
import { priceTicket } from '../../modules/deals/src/engine/pricing.ts';
import { CouponCenter } from '../../modules/deals/src/salon-promotions/coupon-center.ts';
import { DiscountsScreenRepository } from '../../modules/deals/src/salon-promotions/discounts-screen.ts';
import { PromotionsCenter, PromotionsCenterController } from '../../modules/deals/src/salon-promotions/promotions-center.ts';
import { VISHAL } from './cp-extra.mjs';

const P = 'b0de3800-0000-4000-8000-0000000';
const id = (n) => P + String(n).padStart(5, '0');

export function promoExtra(db, pg, { OWNER_USER }) {
  const repo = new KyselyDealsRepository(db);
  const svc = new DealsService(repo);
  const co = new DealsCheckoutService(svc, repo.ledger);
  const center = new PromotionsCenter(db, new CouponCenter(db, svc, co), new DiscountsScreenRepository(db));
  const q = (s, p = []) => pg.query(s, p);
  let visits = 0;
  return {
    async seed(T, B) {
      const cat = id(50), svcId = id(51), cu = id(80);
      await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Gel') on conflict do nothing`, [cat, T, B]);
      await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Full Set',60,10000) on conflict do nothing`, [svcId, T, B, cat]);
      await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1,$2,$3,'Promo','Tester','Promo Tester','+12155550388','promo.tester@example.test','active') on conflict do nothing`, [cu, T, B]);
      return { promotionsSeeded: 1 };
    },
    routes: (routesOf) => [
      ...routesOf('modules/deals/src/salon-promotions/promotions-center.ts', '/pos/promotions', new PromotionsCenterController(center), '@Controller(\'pos/promotions\')'),
    ],
    async control(sp, T, B) {
      const ctx = { tenantId: T, branchId: B, userId: OWNER_USER, role: 'OWNER', permissions: ['pos.marketing.manage', 'pos.marketing.view'], technicianId: null };
      if (sp.get('redeem')) {
        const tk = id(600 + (++visits)); const cu = id(80); const svcId = id(51);
        await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number) values ($1,$2,$3,$4,'ready_checkout',10000,10000,$5)`, [tk, T, B, cu, String(88000 + visits)]);
        await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Gel Full Set',10000,60,10000)`, [T, B, tk, svcId]);
        const cand = await co.candidate(ctx, tk, { code: 'VISHALNG20' });
        const lines = (await q(`select id, line_total_cents from ticket_service_lines where ticket_id = $1`, [tk])).rows.map((l) => ({ lineId: String(l.id), priceCents: Number(l.line_total_cents) }));
        const mine = priceTicket(lines, [cand.offer], await co.policy(ctx)).applied[0];
        await co.reserve(ctx, tk, cand, mine);
        await q(`update tickets set status = 'paid', payment_status = 'paid', paid_at = now(), discount_cents = $2, total_cents = 10000 - $2 where id = $1`, [tk, mine.appliedCents]);
        const a = await co.onPaid(ctx, tk); const b = await co.onPaid(ctx, tk);   // a replayed payment callback
        return { ticketId: tk, ticketNumber: String(88000 + visits), discountCents: mine.appliedCents, first: a, replay: b };
      }
      if (sp.get('many')) {
        const n = Math.min(40, Number(sp.get('many')) || 0); const made = [];
        for (let i = 0; i < n; i++) made.push((await svc.createDeal(ctx, { ownerType: 'salon', kind: 'coupon', title: `Fixture promo ${String(i + 1).padStart(2, '0')}`, discountType: 'percent', discountPercent: 5, code: `FIXTURE${String(i + 1).padStart(2, '0')}X`, serviceIds: [] })).id);
        return { made: made.length };
      }
      return (await q(`select (select count(*)::int from deals where tenant_id = $1 and title = 'vishal') as vishal_rows,
          (select count(*)::int from deal_coupon_codes where deal_id = $2) as vishal_codes, (select status from deals where id = $2) as vishal_status,
          (select redemption_count from deals where id = $2)::int as vishal_used,
          (select count(*)::int from deal_redemptions where tenant_id = $1 and status = 'redeemed') as redeemed,
          (select count(*)::int from deal_redemptions where tenant_id = $1 and status = 'applied') as applied,
          (select count(*)::int from promotion_eligibility_checks where tenant_id = $1) as checks,
          (select count(*)::int from deals where tenant_id = $1 and kind = 'coupon' and status = 'draft') as drafts,
          (select count(*)::int from coupon_assistant_drafts where tenant_id = $1) as assistant_rows,
          (select count(*)::int from campaigns where tenant_id = $1 and status <> 'draft') as campaigns_not_draft,
          (select count(*)::int from notifications where tenant_id = $1) as notifications`, [T, VISHAL])).rows[0];
    },
  };
}
