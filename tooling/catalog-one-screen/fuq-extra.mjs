// fuq-extra.mjs — Communications → Follow-Up Queue in the catalog harness (Follow-Up Queue Complete Build Guide, Oct 30 2026,
// migration 746). REAL controller + service + queue on the seeded TEST database:
//   FollowUpQueueController → DailyFollowUpService + FollowUpQueue (kpis, tasks, contact check, missed calls, results, history, generate)
// The send / skip / approve / reject routes are the existing ones (served by eod-extra.mjs). Nothing leaves the machine:
// follow-ups land in the Customer App inbox table only; no SMS, no email, no push.
// Controls (GET /__fuq?…): seed=1 → its own technician + customers: an overdue task (yesterday), today's tasks (one awaiting
// approval, one without the Customer App, one sent + rebooked, one skipped, one with an open low-rating review), 12 "Zed"
// history tasks for paging, three missed calls (awaiting / replied / recovered) · state=1 → DB truth · reset=1 → rows removed.
import { FollowUpQueueController } from '../../modules/communications/src/end-of-day-followups/followup-queue.controller.ts';

const P = 'e7460000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
export const FUQ = { tech: pid(1), techUser: pid(2) };
const cust = (n) => pid(100 + n);
const app = (n) => pid(200 + n);

export function fuqExtra(db, pg, svc) {
  const q = (s, p = []) => pg.query(s, p);
  const ids = () => Array.from({ length: 30 }, (_, i) => cust(i + 1));
  return {
    routes: (routesOf) => [
      ...routesOf('modules/communications/src/end-of-day-followups/followup-queue.controller.ts', '/pos/follow-up-queue', new FollowUpQueueController(svc, db)),
    ],
    async control(sp, T, B) {
      const tz = (await q(`select coalesce(timezone, 'America/New_York') as tz from branches where id = $1`, [B])).rows[0]?.tz ?? 'America/New_York';
      const today = (await q(`select (now() at time zone $1)::date::text as d`, [tz])).rows[0].d;
      if (sp.get('reset')) {
        await q(`delete from customer_notifications where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids()]);
        await q(`delete from notifications where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids()]);
        await q(`delete from service_follow_up_tasks where tenant_id = $1 and technician_id = $2`, [T, FUQ.tech]);
        await q(`delete from call_intelligence_events where tenant_id = $1 and provider_call_id like 'fuq-%'`, [T]);
        await q(`delete from reviews where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, ids()]);
        await q(`delete from pos_tech_appointments where tenant_id = $1 and technician_id = $2`, [T, FUQ.tech]);
        return { reset: true };
      }
      if (sp.get('seed')) {
        await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Quinn Tech','fuq-tech@pilot.test','active','TECHNICIAN') on conflict (id) do nothing`, [FUQ.techUser, T]);
        await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,$4,'Quinn','Tech','Quinn Tech',true) on conflict (id) do nothing`, [FUQ.tech, T, B, FUQ.techUser]);
        const names = ['Olivia Overdue', 'Amy Approve', 'Nora NoApp', 'Rita Rebooked', 'Sam Skipped', 'Cleo Concern', 'Pia Pending'];
        for (let i = 1; i <= 30; i++) {
          const name = i <= names.length ? names[i - 1] : i <= 19 ? `Zed Match ${i}` : i === 20 ? 'Mona Missed' : i === 21 ? 'Rey Replied' : `Extra ${i}`;
          const hasApp = name !== 'Nora NoApp';
          if (hasApp) await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,$3,$4,'active','CUSTOMER') on conflict (id) do nothing`, [app(i), T, name, `fuq-${i}@pilot.test`]);
          const [f, l] = name.split(' ');
          await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, status, user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) on conflict (id) do nothing`,
            [cust(i), T, B, f, l, name, `+1609555${3000 + i}`, `(609) 555-${3000 + i}`, hasApp ? app(i) : null]);
        }
        const task = (i, date, status, extra = {}) => q(`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id,
            customer_name_snapshot, technician_name_snapshot, customer_app_user_id, status, suggested_message, sent_at, created_at, completed_at, customer_phone_snapshot, service_name_snapshot, submitted_at, skip_reason)
          values ($1,$2,$3::date,$4,$5,gen_random_uuid(),gen_random_uuid(),(select full_name from customers where id = $4),'Quinn Tech',(select user_id from customers where id = $4),$6,
            'Hi! Thanks for visiting today — use cuticle oil tonight.',$7,coalesce($8::timestamptz, now()),$3::date + time '15:00',(select phone_display from customers where id = $4),'Gel manicure',$9,$10) returning id`,
          [T, B, date, cust(i), FUQ.tech, status, extra.sentAt ?? null, extra.createdAt ?? null, status === 'pending_manager_approval' ? new Date().toISOString() : null, extra.skip ?? null]);
        const yesterday = (await q(`select ($1::date - 1)::text as d`, [today])).rows[0].d;
        await task(1, yesterday, 'pending', { createdAt: new Date(Date.now() - 26 * 3600_000).toISOString() });
        await task(2, today, 'pending_manager_approval');
        await task(3, today, 'customer_not_available');
        await task(4, today, 'sent', { sentAt: new Date(Date.now() - 3 * 3600_000).toISOString() });
        await task(5, today, 'skipped', { skip: 'customer_declined' });
        await task(6, today, 'pending');
        await task(7, today, 'pending');
        await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, created_at)
                 values ($1,$2,$3,$4,'Rita Rebooked',($5::date + 21),'10:00','11:00','booked', now() - interval '1 hour')`, [T, B, FUQ.tech, cust(4), today]);
        await q(`insert into reviews (tenant_id, branch_id, customer_id, rating, comment, created_at) values ($1,$2,$3,2,'Chipped after two days', now() - interval '2 days')`, [T, B, cust(6)]);
        for (let i = 8; i <= 19; i++) await task(i, (await q(`select ($1::date - $2::int)::text as d`, [today, i])).rows[0].d, 'sent', { sentAt: new Date(Date.now() - i * 86400_000).toISOString(), createdAt: new Date(Date.now() - i * 86400_000).toISOString() });
        const at = (h) => new Date(Date.now() - h * 3600_000).toISOString();
        await q(`insert into call_intelligence_events (tenant_id, branch_id, provider_call_id, customer_id, caller_phone, direction, status, started_at) values
            ($1,$2,'fuq-mc-1',$3,'+16095553020','inbound','missed',$5), ($1,$2,'fuq-mc-2',$4,'+16095553021','inbound','missed',$5), ($1,$2,'fuq-mc-3',null,'+16095559090','inbound','missed',$5)
            on conflict do nothing`, [T, B, cust(20), cust(21), at(2)]);
        await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, created_at) values ($1,'sms','+16095553021','Sorry we missed your call!',$2,'sent',$3)`, [T, cust(21), at(1)]);
        const appt = (await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values ($1,$2,$3,null,'Walk-in caller',($4::date + 3),'12:00','13:00','booked') returning id`, [T, B, FUQ.tech, today])).rows[0].id;
        await q(`update call_intelligence_events set recovered_appointment_id = $1 where tenant_id = $2 and provider_call_id = 'fuq-mc-3'`, [appt, T]);
        return { seeded: true, today, tz };
      }
      if (sp.get('state')) {
        const tasks = (await q(`select status, count(*)::int as n from service_follow_up_tasks where tenant_id = $1 and technician_id = $2 group by status order by status`, [T, FUQ.tech])).rows;
        const today2 = (await q(`select status, count(*)::int as n from service_follow_up_tasks where tenant_id = $1 and branch_id = $2 and deleted_at is null and business_date = $3::date group by status order by status`, [T, B, today])).rows;
        const msgs = (await q(`select count(*)::int as n from customer_notifications where tenant_id = $1 and type = 'service_follow_up' and customer_id = any($2::uuid[])`, [T, ids()])).rows[0].n;
        const skipReason = (await q(`select skip_reason from service_follow_up_tasks where tenant_id = $1 and customer_id = $2`, [T, cust(7)])).rows[0]?.skip_reason ?? null;
        return { tasks, todayAll: today2, messages: msgs, piaSkipReason: skipReason, today, tz };
      }
      return { ok: true };
    },
  };
}
