// wb-extra.mjs — Marketing & Growth → Win-Back Campaigns / Customers → Customer Retention in the catalog harness (Customer
// Retention & Win-Back Complete Build Guide, Oct 30 2026, migration 749). The REAL RetentionController → RetentionRepository /
// WinBackCenter → SQL on the seeded TEST database. Tooling only — never shipped. Nothing leaves the machine: the SMS service is
// absent (null), the assistant only stores an UNSENT audience, and Campaign Center (cc-extra.mjs) only creates a DRAFT.
// Controls (GET /__wb?…): seed=1 → the guide's cases (never visited ×2, at risk, rebooked, contacted + delivered, email
// unsubscribed, no consent, possible double checkout, a visit without a paid time, a QUEUED win-back text to a customer whose
// only visit was removed) · state=1 → DB truth by independent SQL · reset=1 → this section's rows removed.
import { RetentionRepository } from '../../modules/customers/src/retention/retention.repository.ts';
import { RetentionController } from '../../modules/customers/src/retention/retention.controller.ts';

const P = 'e7490000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
const C = { never1: pid(101), never2: pid(102), tia: pid(103), olga: pid(104), uma: pid(105), nico: pid(106), dee: pid(107), nell: pid(108), gus: pid(109), owen: pid(110) };
export const WB = { ...C, campaign: pid(201), recipient: pid(202), tech: pid(301) };

export function wbExtra(db, pg) {
  const repo = new RetentionRepository(db);
  const ctl = new RetentionController(repo, null);
  const q = (s, p = []) => pg.query(s, p);
  const ids = Object.values(C);
  return {
    routes: (routesOf) => routesOf('modules/customers/src/retention/retention.controller.ts', '/pos/retention', ctl),
    async control(sp, T, B) {
      if (sp.get('reset')) {
        await q(`delete from retention_sms_recipients where tenant_id = $1 and (customer_id = any($2::uuid[]) or campaign_id = $3)`, [T, ids, WB.campaign]);
        await q(`delete from retention_sms_campaigns where tenant_id = $1 and id = $2`, [T, WB.campaign]);
        await q(`delete from notifications where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from notification_opt_outs where tenant_id = $1 and address like 'wb-%@pilot.test'`, [T]);
        await q(`delete from pos_tech_appointments where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from payment_refunds where tenant_id = $1 and payment_id in (select id from payments where tenant_id = $1 and ticket_id in (select id from tickets where tenant_id = $1 and customer_id = any($2::uuid[])))`, [T, ids]);
        await q(`delete from payments where tenant_id = $1 and ticket_id in (select id from tickets where tenant_id = $1 and customer_id = any($2::uuid[]))`, [T, ids]);
        await q(`delete from tickets where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids]);
        await q(`delete from retention_health_runs where tenant_id = $1`, [T]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        const cust = (cid, name, phone, email, sms, age) => q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in, status, created_at)
          values ($1,$2,$3,split_part($4,' ',1),split_part($4,' ',2),$4,$5,$6,$7,$8,'active', now() - make_interval(days => $9)) on conflict (id) do nothing`, [cid, T, B, name, phone, email, sms, !!email, age]);
        await cust(C.never1, 'Wb Nora', '+16095557101', 'wb-nora@pilot.test', true, 500); await cust(C.never2, 'Wb Nate', '+16095557102', null, true, 2);
        await cust(C.tia, 'Wb Tia', '+16095557103', 'wb-tia@pilot.test', true, 300); await cust(C.olga, 'Wb Olga', '+16095557104', 'wb-olga@pilot.test', true, 300);
        await cust(C.uma, 'Wb Uma', '+16095557105', null, true, 300); await cust(C.nico, 'Wb Nico', '+16095557106', null, false, 300);
        await cust(C.dee, 'Wb Dee', '+16095557107', null, true, 300); await cust(C.nell, 'Wb Nell', '+16095557108', null, true, 300);
        await cust(C.gus, 'Wb Gus', '+16095557109', null, true, 300); await cust(C.owen, 'Wb Owen', '+16095557110', 'wb-owen@pilot.test', true, 300);
        let n = 0;
        const tk = async (cid, daysAgo, cents, o = {}) => {
          const tid = pid(400 + (++n));
          await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at, removed_at)
            values ($1,$2,$3,$4,'closed',$5,$6, date_trunc('day', now()) - make_interval(days => $7) + interval '15 hours' + make_interval(mins => $8),
              case when $9::boolean then null else date_trunc('day', now()) - make_interval(days => $7) + interval '15 hours' + make_interval(mins => $8) end, case when $10::boolean then now() end) on conflict (id) do nothing`,
            [tid, T, B, cid, cents, String(97400 + n), daysAgo, o.minutes ?? 0, !!o.noPaid, !!o.removed]);
          return tid;
        };
        await tk(C.tia, 200, 4000); const tiaLast = await tk(C.tia, 80, 6000);
        await tk(C.olga, 120, 5000); await tk(C.uma, 70, 4000); await tk(C.nico, 100, 3500); await tk(C.owen, 10, 3000);
        await tk(C.dee, 40, 4200); await tk(C.dee, 40, 4200, { minutes: 2 });
        await tk(C.nell, 65, 2500, { noPaid: true });
        await tk(C.gus, 90, 3000, { removed: true });
        await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'cash',6000,'succeeded') on conflict (id) do nothing`, [pid(501), T, B, tiaLast]);
        await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, reason) values ($1,$2,$3,1000,'refunded','harness')`, [T, B, pid(501)]);
        await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Wb','Tech','Wb Tech') on conflict (id) do nothing`, [WB.tech, T, B]);
        await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
          values ($1,$2,$3,$4,'Wb Uma',(now() at time zone 'America/New_York')::date + 1,'10:00','11:00','booked','[]')`, [T, B, WB.tech, C.uma]);
        await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, purpose, created_at, delivered_at) values
          ($1,'sms','+16095557103','We miss you',$2,'delivered','marketing', now() - interval '3 days', now() - interval '3 days'),
          ($1,'sms','+16095557104','We miss you',$3,'failed','marketing', now() - interval '3 days', null)`, [T, C.tia, C.olga]);
        await q(`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values ($1,'email','wb-olga@pilot.test','unsubscribe','marketing') on conflict do nothing`, [T]);
        await q(`insert into retention_sms_campaigns (id, tenant_id, status, body, body_sha256, eligible_count, confirmed_at) values ($1,$2,'sending','We miss you','x',1, now()) on conflict (id) do nothing`, [WB.campaign, T]);
        await q(`insert into retention_sms_recipients (id, campaign_id, tenant_id, customer_id, destination, eligibility, status) values ($1,$2,$3,$4,'+16095557109','eligible','queued') on conflict (id) do nothing`, [WB.recipient, WB.campaign, T, C.gus]);
        return { seeded: ids.length };
      }
      if (sp.get('state')) {
        const tz = (await q(`select coalesce(timezone, 'America/New_York') as tz from branches where id = $1`, [B])).rows[0]?.tz ?? 'America/New_York';
        const risk = Number((await q(`select risk_days from tenant_retention_settings where tenant_id = $1`, [T])).rows[0]?.risk_days ?? 60);
        // independent of the repository: visits = settled, not-removed tickets; days = salon-local days since the last one
        const r = (await q(`with v as (select t.customer_id, count(*)::int as visits, max(coalesce(t.paid_at, t.created_at)) as last from tickets t
              where t.tenant_id = $1 and t.customer_id is not null and t.removed_at is null and t.status in ('closed', 'paid') group by t.customer_id),
            c as (select c.id, coalesce(v.visits, 0) as visits, case when v.last is null then null else ((now() at time zone $2)::date - (v.last at time zone $2)::date) end as days
              from customers c left join v on v.customer_id = c.id where c.tenant_id = $1 and c.status <> 'archived')
          select count(*) filter (where visits = 0)::int as never, count(*) filter (where visits > 0 and days >= $3)::int as at_risk,
                 count(*) filter (where visits > 0 and days >= 90)::int as away90 from c`, [T, tz, risk])).rows[0];
        const counts = (await q(`select
            (select count(*)::int from tickets where tenant_id = $1) as tickets, (select coalesce(max(updated_at), 'epoch')::text from tickets where tenant_id = $1) as tickets_updated,
            (select count(*)::int from notifications where tenant_id = $1) as notifications, (select count(*)::int from retention_sms_recipients where tenant_id = $1) as recipients,
            (select status from retention_sms_recipients where id = $2) as gus_recipient,
            (select count(*)::int from segment_audience_drafts where tenant_id = $1) as drafts,
            (select count(*)::int from segment_audience_drafts where tenant_id = $1 and campaign_id is not null) as drafts_linked,
            (select count(*)::int from campaigns where tenant_id = $1 and status = 'draft') as campaign_drafts,
            (select count(*)::int from retention_health_runs where tenant_id = $1) as health_runs`, [T, WB.recipient])).rows[0];
        return { risk, never: r.never, atRisk: r.at_risk, away90: r.away90, ...counts };
      }
      return { error: 'unknown control' };
    },
  };
}
