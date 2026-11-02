// seg-extra.mjs — Marketing & Growth → Customer Segments in the catalog harness (Customer Segments Complete Build Guide, Oct 30
// 2026): the REAL SegmentsController → SegmentsRepository → RetentionRepository CTE → SQL on the seeded TEST database.
// Tooling only — never shipped. Seeds the pilot salon with the photographed customer (Vishaal kumar: 15 settled visits, tier
// Regular, $440.76) plus New / Returning / VIP / Never Visited / Inactive / shared-number / opted-out customers.
// Campaign Center's create route is answered by a TEST stand-in that inserts a draft `campaigns` row (the real
// CampaignsKyselyRepository needs the query builder, which this harness does not have); nothing is ever sent.
// Controls (GET /__seg?…): state=1 → DB truth (segment counts by SQL, drafts, campaigns, notifications / jobs written)
import { RetentionRepository } from '../../modules/customers/src/retention/retention.repository.ts';
import { SegmentsController } from '../../modules/customers/src/segments/segments.controller.ts';

const P = 'c5e93600-0000-4000-8000-0000000';
const id = (n) => P + String(n).padStart(5, '0');

export function segExtra(db, pg) {
  const ctl = new SegmentsController(new RetentionRepository(db));
  const q = (s, p = []) => pg.query(s, p);
  return {
    async seed(T, B) {
      let n = 0;
      const cust = async (cid, name, phone, email, sms, mail, created) => q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in, created_at)
        values ($1,$2,$3,split_part($4,' ',1),split_part($4,' ',2),$4,$5,$6,$7,$8, now() - make_interval(days => $9)) on conflict do nothing`, [cid, T, B, name, phone, email, sms, mail, created]);
      const tk = async (cid, daysAgo, cents) => q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
        values ($1,$2,$3,$4,'closed',$5,$6, date_trunc('day', now()) - make_interval(days => $7) + interval '15 hours', date_trunc('day', now()) - make_interval(days => $7) + interval '15 hours') on conflict do nothing`,
        [id('9' + String(++n).padStart(3, '0')), T, B, cid, cents, String(91000 + n), daysAgo]);
      await cust(id(1), 'Vishaal kumar', '+917762599624', 'vishaal@example.com', true, true, 420);
      for (let i = 0; i < 15; i++) await tk(id(1), 1 + i * 9, i < 14 ? 2938 + (i === 0 ? 0 : 0) : 2944);           // 14 × 29.38 + 29.44 = $440.76
      await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points) values ($1,$2,$3,'Regular',44,44,0) on conflict do nothing`, [T, B, id(1)]);
      await cust(id(2), 'Oona Tran', '+12155550402', 'oona@example.com', true, true, 9); await tk(id(2), 4, 6500);                      // New
      await cust(id(3), 'Tess Pham', '+12155550403', null, true, false, 40); await tk(id(3), 30, 4000); await tk(id(3), 3, 4000);        // Returning
      await cust(id(4), 'Vera Ngo', '+12155550404', 'vera@example.com', true, true, 30); await tk(id(4), 6, 12000);                      // VIP (New)
      await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points, vip_since) values ($1,$2,$3,'VIP',120,120,0, now() - interval '5 days') on conflict do nothing`, [T, B, id(4)]);
      await cust(id(5), 'Ines Lo', '+12155550405', 'ines@example.com', true, true, 300); await tk(id(5), 95, 4500);                     // Inactive
      await cust(id(6), 'Neve Ha', '+12155550406', 'neve@example.com', true, true, 0);                                                    // Never Visited (newest)
      await cust(id(7), 'Dao Vu', '+12155550407', null, true, false, 50); await tk(id(7), 8, 3000);                                     // shared family phone
      await cust(id(8), 'Dung Vu', '+12155550407', null, true, false, 60); await tk(id(8), 8, 3000);
      await cust(id(9), 'Opal Do', '+12155550409', null, true, false, 70); await tk(id(9), 8, 3000);
      await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+12155550409') on conflict do nothing`, [T]);
      for (let i = 0; i < 24; i++) await cust(id(100 + i), `Guest ${String(i + 1).padStart(2, '0')}`, null, null, false, false, 200 + i);  // paging
      return { segmentsSeeded: 9 + 24 };
    },
    routes: (routesOf) => routesOf('modules/customers/src/segments/segments.controller.ts', '/pos/marketing/segments', ctl),
    /** TEST stand-in for POST /pos/campaigns (Campaign Center create = a DRAFT row; status draft; nothing sent) */
    async route(method, path, _query, body, { session, has }) {
      if (method === 'POST' && path === '/pos/campaigns') {
        if (!has('pos.marketing.manage')) return { status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' } } };
        const s = session();
        const r = (await q(`insert into campaigns (tenant_id, name, channel, audience_label, audience_size, status) values ($1,$2,$3,$4,$5,'draft') returning id, name, status, audience_size`,
          [s.tenantId, String(body?.name ?? 'Campaign'), String(body?.channel ?? 'sms'), body?.audienceLabel ?? null, Number(body?.audienceSize ?? 0)])).rows[0];
        return { status: 200, body: { id: String(r.id), name: r.name, status: r.status, audienceSize: Number(r.audience_size) } };
      }
      return undefined;
    },
    async control(sp, T) {
      if (sp.get('state')) {
        const r = (await q(`select
            (select count(*)::int from customers c where c.tenant_id = $1 and c.status <> 'archived') as customers,
            (select count(*)::int from segment_audience_drafts where tenant_id = $1) as drafts,
            (select coalesce(json_agg(json_build_object('status', status, 'eligible', eligible_count, 'selected', selected_count, 'campaign', campaign_id is not null)), '[]'::json) from segment_audience_drafts where tenant_id = $1) as draft_rows,
            (select count(*)::int from campaigns where tenant_id = $1 and status = 'draft') as campaign_drafts,
            (select count(*)::int from campaigns where tenant_id = $1 and status <> 'draft') as campaigns_not_draft,
            (select count(*)::int from notifications where tenant_id = $1) as notifications,
            (select count(*)::int from audit_events where tenant_id = $1 and action like 'segments.%') as audits`, [T])).rows[0];
        const v = (await q(`select count(*) filter (where n = 0)::int as never, count(*) filter (where n = 1)::int as new, count(*) filter (where n >= 2)::int as returning from (
            select c.id, (select count(*) from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.removed_at is null and t.status in ('closed','paid')) as n
            from customers c where c.tenant_id = $1 and c.status <> 'archived') x`, [T])).rows[0];
        // the newest customer by the list's own default order (created_at DESC, id DESC) — other harness seeds (Promotions'
        // "Promo Tester", Campaign Center's audience) add customers too, so steps compare against this, never a fixed name
        const newest = (await q(`select full_name from customers where tenant_id = $1 and status <> 'archived' order by created_at desc, id desc limit 1`, [T])).rows[0]?.full_name ?? null;
        return { ...r, visitClasses: v, newest };
      }
      return { ok: true };
    },
  };
}
