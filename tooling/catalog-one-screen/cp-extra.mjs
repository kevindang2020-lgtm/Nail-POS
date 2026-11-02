// cp-extra.mjs — Marketing → Coupons in the catalog harness (Coupons & Promotions Management Center guide, Oct 30 2026): the
// REAL DealsController (create / lifecycle / duplicate / codes) and CouponCenterController (check / campaigns / health /
// assistant) over the seeded TEST database, beside the Discounts read model extra.mjs already serves. Seeds the guide's
// screenshot record — "vishal", 20 % off, code ending NG20, Active, 0 redemptions — an unpaid ticket to check it against
// (#77001, one $33.35 service) and a campaign linked through a code batch. Tooling only; nothing is sent or charged.
// Controls (GET /__cp?…): state=1 → DB truth (vishal row count, redemptions, drafts, assistant rows, campaigns)
import { hashCode, codeHint } from '../../modules/deals/src/engine/coupons.ts';
import { KyselyDealsRepository } from '../../modules/deals/src/deals/deals.kysely.repository.ts';
import { DealsService } from '../../modules/deals/src/deals/deals.service.ts';
import { DealsController } from '../../modules/deals/src/deals/deals.controller.ts';
import { DealsCheckoutService } from '../../modules/deals/src/engine/deals-checkout.service.ts';
import { CouponCenter, CouponCenterController } from '../../modules/deals/src/salon-promotions/coupon-center.ts';
import { SalonPromotionsController } from '../../modules/deals/src/salon-promotions/salon-promotions.controller.ts';
import { SalonPromotionsService } from '../../modules/deals/src/salon-promotions/salon-promotions.service.ts';
import { KyselySalonPromotionsRepository } from '../../modules/deals/src/salon-promotions/salon-promotions.kysely.repository.ts';

const P = 'c0de3600-0000-4000-8000-0000000';
const id = (n) => P + String(n).padStart(5, '0');
export const VISHAL = id(1);

export function cpExtra(db, pg) {
  const repo = new KyselyDealsRepository(db);
  const svc = new DealsService(repo);
  const center = new CouponCenter(db, svc, new DealsCheckoutService(svc, repo.ledger));
  const q = (s, p = []) => pg.query(s, p);
  return {
    async seed(T, B) {
      await q(`insert into deals (id, tenant_id, branch_id, owner_type, kind, title, discount_type, discount_percent, status, redemption_count, stackable, requires_code, published_at, created_at, updated_at)
        values ($1,$2,null,'salon','coupon','vishal','percent',20,'active',0,false,true, now() - interval '3 days', now() - interval '3 days', now() - interval '3 days') on conflict do nothing`, [VISHAL, T]);
      await q(`insert into deal_coupon_codes (tenant_id, deal_id, code_hash, code_hint, status) values ($1,$2,$3,$4,'active') on conflict do nothing`, [T, VISHAL, hashCode(T, 'VISHALNG20'), codeHint('VISHALNG20')]);
      await q(`insert into deal_versions (deal_id, tenant_id, version, terms) values ($1,$2,1,'{"title":"vishal","kind":"coupon","discountType":"percent","discountPercent":20}'::jsonb) on conflict do nothing`, [VISHAL, T]);
      const cat = id(50), svcId = id(51), tk = id(60);
      await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Manicure') on conflict do nothing`, [cat, T, B]);
      await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Classic Manicure',30,3335) on conflict do nothing`, [svcId, T, B, cat]);
      const cu = id(80);
      await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Coupon','Tester','Coupon Tester','+12155550777','active') on conflict do nothing`, [cu, T, B]);
      await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number) values ($1,$2,$3,$4,'ready_checkout',3335,3335,'77001') on conflict do nothing`, [tk, T, B, cu]);
      await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'Classic Manicure',3335,30,3335)`, [T, B, tk, svcId]);
      const camp = id(70);
      await q(`insert into campaigns (id, tenant_id, name, channel, status) values ($1,$2,'Fall regulars SMS','sms','draft') on conflict do nothing`, [camp, T]);
      await q(`insert into deal_coupon_batches (tenant_id, deal_id, quantity, single_use, purpose, campaign_id) values ($1,$2,25,true,'marketing',$3)`, [T, VISHAL, camp]);
      return { couponsSeeded: 1 };
    },
    routes: (routesOf) => [
      ...routesOf('modules/deals/src/deals/deals.controller.ts', '/pos/deals', new DealsController(svc)),
      ...routesOf('modules/deals/src/salon-promotions/salon-promotions.controller.ts', '/pos/salon-promotions', new SalonPromotionsController(new SalonPromotionsService(new KyselySalonPromotionsRepository(db)))),
      ...routesOf('modules/deals/src/salon-promotions/coupon-center.ts', '/pos/coupons', new CouponCenterController(center), '@Controller(\'pos/coupons\')'),
    ],
    /** GET /pos/deals (and ?kind=): the controller's bare @Get() is not picked up by routesOf — answered here through the same service */
    async route(method, path, query, body, { session, has }) {
      if (method === 'GET' && path === '/pos/deals') {
        if (!has('pos.marketing.view')) return { status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' } } };
        const s = session();
        return { status: 200, body: await svc.listDeals({ tenantId: s.tenantId, branchId: s.branchId, userId: s.userId, role: s.role, permissions: s.permissions }, { status: query?.status || undefined, kind: query?.kind || undefined }) };
      }
      if (method === 'POST' && path === '/pos/deals') {   // bare @Post() too: create (a salon deal starts as a draft)
        if (!has('pos.marketing.manage')) return { status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' } } };
        const s = session();
        try { return { status: 200, body: await svc.createDeal({ tenantId: s.tenantId, branchId: s.branchId, userId: s.userId, role: s.role, permissions: s.permissions }, { ownerType: 'salon', ...(body ?? {}) }) }; }
        catch (e) { return { status: 400, body: { error: { code: e?.apiCode ?? 'VALIDATION_FAILED', message: e?.message } } }; }
      }
      return undefined;
    },
    async control(sp, T) {
      if (sp.get('state')) {
        return (await q(`select (select count(*)::int from deals where tenant_id = $1 and title = 'vishal') as vishal_rows,
            (select count(*)::int from deal_coupon_codes where deal_id = $2) as vishal_codes,
            (select count(*)::int from deal_redemptions where tenant_id = $1) as redemptions,
            (select count(*)::int from deal_redemption_holds where tenant_id = $1) as holds,
            (select count(*)::int from deals where tenant_id = $1 and kind = 'coupon' and status = 'draft') as drafts,
            (select count(*)::int from deals where tenant_id = $1 and kind = 'coupon' and status = 'active') as active,
            (select count(*)::int from coupon_assistant_drafts where tenant_id = $1) as assistant_rows,
            (select count(*)::int from campaigns where tenant_id = $1 and status <> 'draft') as campaigns_not_draft,
            (select count(*)::int from notifications where tenant_id = $1) as notifications,
            (select status from deals where id = $2) as vishal_status`, [T, VISHAL])).rows[0];
      }
      return { ok: true };
    },
  };
}
