// rf-extra.mjs — Marketing & Growth → Referral Program in the catalog harness (Referral Program guide, Oct 30 2026, migration 751).
// The REAL ReferralProgramController → ReferralProgram → SQL on the seeded TEST database. Tooling only — never shipped. Nothing
// leaves the machine: no message is sent; the assistant only saves an UNSENT audience.
// Controls (GET /__rf?…): seed=1 → a referrer with a code, new customers, a shared-phone customer, an existing customer ·
// pay=<key> → a completed PAID first visit + exactly what the checkout.completed consumer does (qualifyForTicket) ·
// many=1 → 12 more recorded referrals (paging) · state=1 → DB truth by independent SQL · reset=1 → this section's rows removed.
import { ReferralProgram } from '../../modules/customers/src/pos-referrals/referral-program.ts';
import { ReferralProgramController } from '../../modules/customers/src/pos-referrals/referral-program.controller.ts';

const P = 'e7510000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
const C = { rita: pid(101), nia: pid(102), noah: pid(103), olga: pid(104), pia: pid(105) };
const EXTRA = Array.from({ length: 12 }, (_, i) => pid(200 + i));
export const RF = { ...C };

export function rfExtra(db, pg) {
  const rp = new ReferralProgram(db);
  const ctl = new ReferralProgramController(rp);
  const q = (s, p = []) => pg.query(s, p);
  const ids = [...Object.values(C), ...EXTRA];
  return {
    rp,
    routes: (routesOf) => routesOf('modules/customers/src/pos-referrals/referral-program.controller.ts', '/pos/referral-program', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`set session_replication_role = replica`);   // referral_events is append-only by trigger — the harness reset only
        try {
          await q(`delete from referral_events where tenant_id = $1 and referral_id in (select id from referral_redemptions where tenant_id = $1 and referred_customer_id = any($2::uuid[]))`, [T, ids]);
          await q(`delete from loyalty_ledger where tenant_id = $1 and source_table = 'referral_rewards' and customer_id = any($2::uuid[])`, [T, ids]);
        } finally { await q(`set session_replication_role = origin`); }
        await q(`delete from referral_rewards where tenant_id = $1 and recipient_customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from referral_redemptions where tenant_id = $1 and (referred_customer_id = any($2::uuid[]) or referrer_customer_id = any($2::uuid[]))`, [T, ids]);
        await q(`delete from customer_loyalty_profiles where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from referral_program_settings where tenant_id = $1`, [T]);
        await q(`delete from segment_audience_members where tenant_id = $1 and draft_id in (select id from segment_audience_drafts where tenant_id = $1 and idempotency_key like 'referral-assistant:%')`, [T]);
        await q(`delete from segment_audience_drafts where tenant_id = $1 and idempotency_key like 'referral-assistant:%'`, [T]);
        await q(`delete from payment_refunds where tenant_id = $1 and payment_id in (select p.id from payments p join tickets t on t.id = p.ticket_id where t.customer_id = any($2::uuid[]))`, [T, ids]);
        await q(`delete from payments where tenant_id = $1 and ticket_id in (select id from tickets where tenant_id = $1 and customer_id = any($2::uuid[]))`, [T, ids]);
        await q(`delete from tickets where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from customer_referrals where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from customers where tenant_id = $1 and id = any($2::uuid[])`, [T, ids]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        const cust = (cid, name, phone) => q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, status)
          values ($1,$2,$3,split_part($4,' ',1),split_part($4,' ',2),$4,$5,$6,true,'active') on conflict (id) do nothing`, [cid, T, B, name, phone, name.toLowerCase().replace(/ /g, '.') + '@pilot.test']);
        await cust(C.rita, 'Rf Rita', '+16095579001'); await cust(C.nia, 'Rf Nia', '+16095579002'); await cust(C.noah, 'Rf Noah', '+16095579001');
        await cust(C.olga, 'Rf Olga', '+16095579004'); await cust(C.pia, 'Rf Pia', '+16095579005');
        for (let i = 0; i < EXTRA.length; i++) await cust(EXTRA[i], `Rf Many${String(i).padStart(2, '0')}`, '+160955791' + String(i).padStart(2, '0'));
        await q(`insert into customer_referrals (tenant_id, customer_id, code) values ($1,$2,'RFRITA') on conflict do nothing`, [T, C.rita]);
        for (const days of [40, 10]) {   // Olga: an existing customer with two paid visits
          const t = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at) values ($1,$2,$3,'paid',4000,0,0,4000, now() - make_interval(days => $4)) returning id`, [T, B, C.olga, days])).rows[0].id;
          await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',4000,0,'approved')`, [T, B, t]);
        }
        return { seeded: ids.length };
      }
      if (sp.get('pay')) {
        const cid = C[sp.get('pay')] ?? null;
        if (!cid) return { error: 'unknown customer' };
        const t = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_at, ticket_number)
          values ($1,$2,$3,'paid',6500,0,0,6500, now(), $4) returning id, ticket_number`, [T, B, cid, String(7000 + Math.floor(Math.random() * 999))])).rows[0];
        await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',6500,0,'approved')`, [T, B, t.id]);
        const out = await rp.qualifyForTicket(T, String(t.id), 'harness:checkout.completed');
        return { ticketId: String(t.id), ticketNumber: t.ticket_number, ...out };
      }
      if (sp.get('many')) {
        const ctx = { tenantId: T, branchId: B, userId: null, role: 'OWNER', permissions: [] };
        for (let i = 0; i < EXTRA.length; i++) await rp.record(ctx, { code: 'RFRITA', referredCustomerId: EXTRA[i], idempotencyKey: `harness-many-${i}` });
        return { recorded: EXTRA.length };
      }
      if (sp.get('state')) {
        const r = (await q(`select (select count(*)::int from customer_referrals where tenant_id = $1) as codes,
            (select count(*)::int from customer_referrals where tenant_id = $1 and status = 'active') as codes_active,
            (select count(*)::int from referral_redemptions where tenant_id = $1) as referrals,
            (select count(*)::int from referral_redemptions where tenant_id = $1 and redeemed_at >= date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York') as today,
            (select count(*)::int from referral_rewards where tenant_id = $1 and state in ('PENDING_APPROVAL','APPROVED','FAILED')) as pending_reward,
            (select count(*)::int from loyalty_ledger where tenant_id = $1 and source_table = 'referral_rewards') as ledger,
            (select count(*)::int from referral_events where tenant_id = $1) as events,
            (select count(*)::int from notifications where tenant_id = $1) as notifications,
            (select count(*)::int from segment_audience_drafts where tenant_id = $1 and idempotency_key like 'referral-assistant:%') as drafts,
            (select count(*)::int from customers where tenant_id = $1 and id in ($2, $3)) as rita_noah`, [T, C.rita, C.noah])).rows[0];
        const st = (await q(`select c.full_name, rr.state from referral_redemptions rr join customers c on c.id = rr.referred_customer_id where rr.tenant_id = $1 and rr.referred_customer_id = any($2::uuid[])`, [T, Object.values(C)])).rows;
        return { ...r, states: Object.fromEntries(st.map((x) => [x.full_name, x.state])) };
      }
      return { error: 'unknown control' };
    },
  };
}
