// mg-extra.mjs — Marketing → Marketing & Growth in the catalog harness (Marketing & Growth Complete Build Guide, Oct 30 2026):
// the REAL MarketingGrowthController → MarketingGrowthRepository → SQL on the seeded TEST database, plus the REAL Campaign
// Center overview the dashboard reads. Tooling only — never shipped. Seeded ON DEMAND (/__mg?seed=1) so the other sections'
// fixtures stay exactly as before. The photographed screen showed 2 loyalty members and 1,298 points outstanding, 2
// referral codes, 0 referrals, 4 five-star reviews: this seeds a salon with those records (Mia + Noah, 1,000 + 298 points
// with matching ledgers), a gift card with its ledger, and a campaign message — and nothing is ever sent.
// Controls (GET /__mg?…): seed=1 · state=1 → DB truth (points Σ balances / Σ ledger, gift-card owed, reviews, audit rows)
import { RetentionRepository } from '../../modules/customers/src/retention/retention.repository.ts';
import { CampaignCenter } from '../../modules/communications/src/campaigns/campaign-center.ts';
import { MarketingGrowthRepository } from '../../modules/reports/src/marketing-growth/marketing-growth.repository.ts';
import { MarketingGrowthController } from '../../modules/reports/src/marketing-growth/marketing-growth.controller.ts';

const P = 'a6e74000-0000-4000-8000-0000000';
const id = (n) => P + String(n).padStart(5, '0');
export const MIA = id(1);

export function mgExtra(db, pg) {
  const repo = new MarketingGrowthRepository(db, new RetentionRepository(db), new CampaignCenter(db, async () => { throw new Error('read-only'); }));
  const q = (s, p = []) => pg.query(s, p);
  return {
    async seed(T, B) {
      if ((await q(`select 1 from customers where id = $1`, [MIA])).rows.length) return { marketingGrowthSeeded: 0 };
      const cust = (cid, first, last, phone, email, sms, days) => q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status, marketing_sms_opt_in, marketing_email_opt_in, created_at)
        values ($1,$2,$3,$4,$5,$4 || ' ' || $5,$6,$7,'active',$8,false, now() - make_interval(days => $9)) on conflict (id) do nothing`, [cid, T, B, first, last, phone, email, sms, days]);
      await cust(MIA, 'Mia', 'Journey', '+12155557001', 'mia@example.com', true, 500);
      await cust(id(2), 'Noah', 'Points', '+12155557002', null, false, 480);
      let bal = {};
      const led = (c, type, delta, days) => { bal[c] = (bal[c] ?? 0) + delta;
        return q(`insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, source_table, source_id, created_at) values ($1,$2,$3,$4,$5,$6,'harness',gen_random_uuid(), now() - make_interval(days => $7))`, [T, B, c, type, delta, bal[c], days]); };
      await led(MIA, 'earn', 1100, 40); await led(MIA, 'redeem', -100, 6); await led(id(2), 'earn', 298, 12);
      await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points) values ($1,$2,$3,'Gold',1000,1100,100), ($1,$2,$4,'Regular',298,298,0) on conflict do nothing`, [T, B, MIA, id(2)]);
      await q(`insert into customer_referrals (tenant_id, customer_id, code) values ($1,$2,'MIA10'), ($1,$3,'NOAH10') on conflict do nothing`, [T, MIA, id(2)]);
      await q(`insert into gift_cards (id, tenant_id, branch_id, code, initial_balance_cents, balance_cents, status, customer_id, card_number_last4, reference) values ($1,$2,$3,'MGGC-1',5000,3500,'partially_redeemed',$4,'7311','MGREF7311') on conflict (id) do nothing`, [id(10), T, B, MIA]);
      await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, created_at) values ($1,$2,$3,'activate',5000,5000, now() - interval '20 days'), ($1,$2,$3,'redeem',-1500,3500, now() - interval '2 days')`, [T, B, id(10)]);
      for (let i = 0; i < 4; i++) await q(`insert into reviews (tenant_id, branch_id, customer_id, rating, comment, source, created_at) values ($1,$2,$3,5,$4,'google', now() - make_interval(days => $5))`, [T, B, i === 0 ? MIA : null, ['Perfect gel set', 'Lovely staff', 'Best pedicure', 'Clean and calm'][i], 3 + i]);
      await q(`insert into campaigns (id, tenant_id, name, channel, audience_label, audience_size, status, created_at) values ($1,$2,'Mia welcome back','sms','Returning',1,'completed', now() - interval '5 days') on conflict (id) do nothing`, [id(20), T]);
      await q(`insert into ai_marketing_campaign_sends (tenant_id, branch_id, campaign_id, customer_id, channel, message_version, status, provider_id, created_at) values ($1,$2,$3,$4,'sms',1,'sent','SMtest-mg-1', now() - interval '5 days')`, [T, B, id(20), MIA]);
      return { marketingGrowthSeeded: 1 };
    },
    routes: (routesOf) => routesOf('modules/reports/src/marketing-growth/marketing-growth.controller.ts', '/pos/marketing-growth', new MarketingGrowthController(repo)),
    async control(sp, T, B) {
      if (sp.get('seed')) return this.seed(T, B);
      if (sp.get('state')) {
        const r = (await q(`select
            (select coalesce(sum(points_balance), 0)::int from customer_loyalty_profiles where tenant_id = $1) as points,
            (select coalesce(sum(delta), 0)::int from loyalty_ledger where tenant_id = $1) as ledger,
            (select count(*)::int from customer_loyalty_profiles where tenant_id = $1) as members,
            (select coalesce(sum(balance_cents) filter (where status in ('active', 'partially_redeemed', 'frozen')), 0)::int from gift_cards where tenant_id = $1) as gift_owed,
            (select count(*)::int from reviews where tenant_id = $1) as reviews,
            (select count(*)::int from audit_events where tenant_id = $1 and action like 'marketing.%') as audits,
            (select count(*)::int from notifications where tenant_id = $1) as notifications`, [T])).rows[0];
        return r;
      }
      return { ok: true };
    },
  };
}
