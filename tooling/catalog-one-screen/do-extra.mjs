// do-extra.mjs — Marketing → Deals & Offers in the catalog harness (Deals & Offers guide, Oct 30 2026): the REAL
// DealsCenterController (pos/deals-offers: kpis / library / approvals / redemptions / details / check / health / assistant)
// over the seeded TEST database, beside cp-extra.mjs (which serves pos/deals — create, lifecycle, approve / reject / request
// changes — and seeds "vishal" 20%). Seeds the guide's screenshot: "Spring time" 5% on a $10.00 service (→ $9.50, Active),
// technician deals ON with manager approval and a 10% cap, a technician's 8% proposal waiting, one proposal the OWNER filed
// (so self-approval can be shown refused), and one completed $0.50 redemption on a paid ticket. Tooling only.
// Controls (GET /__do?…): state=1 → DB truth (Spring time row, redemptions, approval decisions, pending count, drafts)
import { KyselyDealsRepository } from '../../modules/deals/src/deals/deals.kysely.repository.ts';
import { DealsService } from '../../modules/deals/src/deals/deals.service.ts';
import { DealsCheckoutService } from '../../modules/deals/src/engine/deals-checkout.service.ts';
import { DiscountsScreenRepository } from '../../modules/deals/src/salon-promotions/discounts-screen.ts';
import { CouponCenter } from '../../modules/deals/src/salon-promotions/coupon-center.ts';
import { DealsCenter, DealsCenterController } from '../../modules/deals/src/deals/deals-center.ts';

const P = 'd0ff3700-0000-4000-8000-0000000';
const id = (n) => P + String(n).padStart(5, '0');
export const SPRING = id(1), LISA_P = id(2), OWNER_P = id(3), LISA = id(10), MINH = id(11);

export function doExtra(db, pg, { OWNER_USER, TECH_USER }) {
  const repo = new KyselyDealsRepository(db);
  const svc = new DealsService(repo);
  const center = new DealsCenter(db, new DiscountsScreenRepository(db, 'all'), new CouponCenter(db, svc, new DealsCheckoutService(svc, repo.ledger), 'all'), svc);
  const q = (s, p = []) => pg.query(s, p);
  return {
    async seed(T, B) {
      await q(`insert into deal_settings (tenant_id, allow_technician_deals, max_discount_percent) values ($1,'on_with_approval',10)
        on conflict (tenant_id) do update set allow_technician_deals = 'on_with_approval', max_discount_percent = 10`, [T]);
      const cat = id(50), s10 = id(51), sped = id(52);
      await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Polish') on conflict do nothing`, [cat, T, B]);
      await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Polish change',20,1000), ($5,$2,$3,$4,'Spa pedicure',45,5000) on conflict do nothing`, [s10, T, B, cat, sped]);
      await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lisa','Tran','Lisa Tran'), ($4,$2,$3,'Minh','Le','Minh Le') on conflict do nothing`, [LISA, T, B, MINH]);
      // Spring time — 5% salon deal on the $10.00 Polish change, Active (approved by the owner 4 days ago)
      await q(`insert into deals (id, tenant_id, branch_id, owner_type, kind, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, redemption_count, stackable, published_at, created_by_user_id, approved_by_user_id, created_at, updated_at)
        values ($1,$2,null,'salon','deal','Spring time','percent',5,1000,950,'active',0,false, now() - interval '4 days', $3, $3, now() - interval '5 days', now() - interval '4 days') on conflict do nothing`, [SPRING, T, OWNER_USER]);
      await q(`insert into deal_services (deal_id, service_id, tenant_id) values ($1,$2,$3) on conflict do nothing`, [SPRING, s10, T]);
      await q(`insert into deal_versions (deal_id, tenant_id, version, terms) values ($1,$2,1,'{"title":"Spring time","discountType":"percent","discountPercent":5}'::jsonb) on conflict do nothing`, [SPRING, T]);
      await q(`insert into deal_approvals (deal_id, tenant_id, approver_user_id, decision, reason, deal_version, created_at) values ($1,$2,$3,'approved',null,1, now() - interval '4 days')`, [SPRING, T, OWNER_USER]);
      // Lisa's 8% proposal (waiting 2 days) and one technician proposal the OWNER filed for Minh (waiting 1 day)
      for (const [pid, title, pct, tech, by, age] of [[LISA_P, 'Lisa 8% polish', 8, LISA, TECH_USER, 2], [OWNER_P, 'Minh 6% pedicure', 6, MINH, OWNER_USER, 1]]) {
        const svcId = pid === LISA_P ? s10 : sped; const orig = pid === LISA_P ? 1000 : 5000;
        await q(`insert into deals (id, tenant_id, branch_id, owner_type, technician_id, kind, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, stackable, created_by_user_id, created_by_technician_id, created_at, updated_at)
          values ($1,$2,null,'technician',$3,'deal',$4,'percent',$5,$6,$7,'pending_approval',false,$8,$3, now() - make_interval(days => $9), now() - make_interval(days => $9)) on conflict do nothing`,
          [pid, T, tech, title, pct, orig, orig - Math.floor((orig * pct) / 100), by, age]);
        await q(`insert into deal_services (deal_id, service_id, tenant_id) values ($1,$2,$3) on conflict do nothing`, [pid, svcId, T]);
        await q(`insert into deal_versions (deal_id, tenant_id, version, terms, created_at) values ($1,$2,1,$3::jsonb, now() - make_interval(days => $4)) on conflict do nothing`, [pid, T, JSON.stringify({ title, discountType: 'percent', discountPercent: pct }), age]);
      }
      // one completed Spring time redemption on a PAID ticket (Ava Kim): $10.00 − $0.50
      const cu = id(80), tk = id(60);
      await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1,$2,$3,'Ava','Kim','Ava Kim','+12155550101','ava.kim@example.test','active') on conflict do nothing`, [cu, T, B]);
      await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number, paid_at) values ($1,$2,$3,$4,'paid',1000,950,'77101', now() - interval '1 day') on conflict do nothing`, [tk, T, B, cu]);
      await q(`insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, ticket_id, technician_id, amount_discounted_cents, deal_version, status, kind, applied_at, redeemed_at, idempotency_key)
        values ($1,$2,$3,$4,$5,$6,50,1,'redeemed','deal', now() - interval '1 day', now() - interval '1 day', 'seed-spring-1') on conflict do nothing`, [SPRING, T, B, cu, tk, LISA]);
      await q(`update deals set redemption_count = 1 where id = $1`, [SPRING]);
      // an unpaid ticket to check against: #77102, one $10.00 Polish change
      const tk2 = id(61);
      await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number) values ($1,$2,$3,$4,'ready_checkout',1000,1000,'77102') on conflict do nothing`, [tk2, T, B, cu]);
      await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Polish change',1000,20,1000)`, [T, B, tk2, s10]);
      return { dealsOffersSeeded: 3 };
    },
    routes: (routesOf) => [
      ...routesOf('modules/deals/src/deals/deals-center.ts', '/pos/deals-offers', new DealsCenterController(center), '@Controller(\'pos/deals-offers\')'),
    ],
    async control(sp, T) {
      if (sp.get('state')) {
        return (await q(`select (select count(*)::int from deals where tenant_id = $1 and title = 'Spring time') as spring_rows,
            (select original_price_cents::int from deals where id = $2) as spring_original, (select final_price_cents::int from deals where id = $2) as spring_final,
            (select status from deals where id = $2) as spring_status, (select redemption_count::int from deals where id = $2) as spring_count,
            (select count(*)::int from deal_redemptions where tenant_id = $1) as redemptions, (select count(*)::int from deal_redemption_holds where tenant_id = $1) as holds,
            (select count(*)::int from deals where tenant_id = $1 and status = 'pending_approval') as pending,
            (select status from deals where id = $3) as lisa_status, (select status from deals where id = $4) as owner_filed_status,
            (select coalesce(json_agg(json_build_object('decision', decision, 'reason', reason) order by created_at), '[]') from deal_approvals where deal_id = $3) as lisa_decisions,
            (select count(*)::int from deals where tenant_id = $1 and status = 'draft' and kind = 'deal') as deal_drafts,
            (select count(*)::int from coupon_assistant_drafts where tenant_id = $1) as assistant_rows,
            (select count(*)::int from notifications where tenant_id = $1) as notifications`, [T, SPRING, LISA_P, OWNER_P])).rows[0];
      }
      return { ok: true };
    },
  };
}
