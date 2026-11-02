// eod-extra.mjs — Communications → End-of-Day Follow-Ups in the catalog harness (EOD Follow-Ups Complete Build Guide, Oct 30
// 2026, migration 745). REAL controllers + service + repository on the seeded TEST database:
//   EodFollowUpCenterController → DailyFollowUpService + EodCenter (summary, health, preview, runs, history, detail, send/approve/reject)
//   FollowUpPosController → the existing settings route (GET/PATCH pos/follow-ups/settings)
// Nothing leaves the machine: follow-ups are delivered to the Customer App inbox table only; no SMS, no email, no push.
// Controls (GET /__eod?…): seed=1 → technicians, Customer App users, today's completed services (one archived client, one already
// booked, one served by two technicians, one without the app), 24 older skipped tasks for paging ·
// clock=HH:MM → run the REAL scheduler gate (runDueBranches) at that salon-local time today (controlled clock) ·
// expire=1 → the REAL expiry sweep as if 25 hours had passed · workers=1 → scheduler heartbeats (health turns Ready) ·
// approval=1|0 → "Require manager approval" · tech=1 → act as the first technician (submit a task for approval) ·
// state=1 → DB truth · reset=1 → this section's rows removed.
import { EodFollowUpCenterController } from '../../modules/communications/src/end-of-day-followups/eod-center.controller.ts';
import { FollowUpPosController } from '../../modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts';
import { DailyFollowUpService } from '../../modules/communications/src/end-of-day-followups/end-of-day-followups.service.ts';
import { KyselyDailyFollowUpRepository } from '../../modules/communications/src/end-of-day-followups/end-of-day-followups.kysely.repository.ts';

const P = 'e7450000-0000-4000-8000-';
const pid = (n) => P + String(n).padStart(12, '0');
export const EOD = { t1: pid(1), t2: pid(2), u1: pid(3), u2: pid(4), cat: pid(5), svc: pid(6), ava: pid(11), ben: pid(12), cara: pid(13), dina: pid(14), finn: pid(15), gus: pid(16) };
const PEOPLE = [['ava', 'Ava Kim', true, 'active'], ['ben', 'Ben Lo', false, 'active'], ['cara', 'Cara Archived', true, 'archived'], ['dina', 'Dina Booked', true, 'active'], ['finn', 'Finn Twice', true, 'active'], ['gus', 'Gus Older', true, 'active']];

export function eodExtra(db, pg) {
  const q = (s, p = []) => pg.query(s, p);
  const repo = new KyselyDailyFollowUpRepository(db, null);
  const svc = new DailyFollowUpService(repo);
  const tzOf = async (B) => (await q(`select coalesce(timezone, 'America/New_York') as tz from branches where id = $1`, [B])).rows[0]?.tz ?? 'America/New_York';
  const localToday = async (tz) => (await q(`select (now() at time zone $1)::date::text as d`, [tz])).rows[0].d;

  return {
    svc,
    routes: (routesOf) => [
      ...routesOf('modules/communications/src/end-of-day-followups/eod-center.controller.ts', '/pos/eod-follow-ups', new EodFollowUpCenterController(svc, db)),
      ...routesOf('modules/communications/src/end-of-day-followups/end-of-day-followups.pos.controller.ts', '/pos/follow-ups', new FollowUpPosController(svc)),
    ],
    async control(sp, T, B) {
      const tz = await tzOf(B);
      if (sp.get('reset')) {
        await q(`delete from service_follow_up_tasks where tenant_id = $1 and technician_id = any($2::uuid[])`, [T, [EOD.t1, EOD.t2]]);
        await q(`delete from daily_follow_up_generation_runs where tenant_id = $1 and branch_id = $2`, [T, B]);
        await q(`delete from daily_follow_up_settings where tenant_id = $1 and branch_id = $2`, [T, B]);
        await q(`delete from technician_notifications where tenant_id = $1 and technician_id = any($2::uuid[])`, [T, [EOD.t1, EOD.t2]]);
        await q(`delete from customer_notifications where tenant_id = $1 and customer_id = any($2::uuid[])`, [T, PEOPLE.map(([k]) => EOD[k])]);
        await q(`delete from scheduler_runs where name in ('followups.run_due', 'followups.expire_stale')`);
        return { reset: true };
      }
      if (sp.get('seed')) {
        const today = await localToday(tz);
        await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Ana One','eod-ana@pilot.test','active','TECHNICIAN'), ($3,$2,'Bo Two','eod-bo@pilot.test','active','TECHNICIAN') on conflict (id) do nothing`, [EOD.u1, T, EOD.u2]);
        await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,$4,'Ana','One','Ana One',true), ($5,$2,$3,$6,'Bo','Two','Bo Two',true) on conflict (id) do nothing`, [EOD.t1, T, B, EOD.u1, EOD.t2, EOD.u2]);
        await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'EOD Nails') on conflict (id) do nothing`, [EOD.cat, T, B]);
        await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel manicure',60,5000) on conflict (id) do nothing`, [EOD.svc, T, B, EOD.cat]);
        let n = 0;
        for (const [k, name, app, status] of PEOPLE) {
          n++;
          const appUser = app ? pid(100 + n) : null;
          if (appUser) await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,$3,$4,'active','CUSTOMER') on conflict (id) do nothing`, [appUser, T, name, `eod-${k}@pilot.test`]);
          const [f, l] = name.split(' ');
          await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, status, user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
            [EOD[k], T, B, f, l, name, `+1609555020${n}`, `(609) 555-020${n}`, status, appUser]);
        }
        await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values ($1,$2,$3,$4,'Dina Booked',($5::date + 14),'10:00','11:00','booked')`, [T, B, EOD.t1, EOD.dina, today]);
        // today's completed services at FIXED salon-local times on the salon's business date (10:00–10:45), never
        // "N minutes ago": relative times fell into YESTERDAY when the harness ran between 00:00 and 01:00 local.
        // The generation window is the whole business day, so these count whatever the real clock says. Finn is
        // served by both technicians.
        const lines = [['ava', EOD.t1, '10:00'], ['ben', EOD.t2, '10:05'], ['cara', EOD.t1, '10:10'], ['dina', EOD.t1, '10:15'], ['finn', EOD.t1, '10:30'], ['finn', EOD.t2, '10:45']];
        let i = 0;
        for (const [k, tech, hhmm] of lines) {
          i++;
          const at = (await q(`select ($1::date + $2::time) at time zone $3 as at`, [today, hhmm, tz])).rows[0].at;
          const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at, total_cents, ticket_number) values ($1,$2,$3,'paid', $4, 5000, $5) returning id`, [T, B, EOD[k], at, `EOD-${200 + i}`])).rows[0].id;
          await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, status, completed_at)
                   values ($1,$2,$3,$4,'Gel manicure',5000,60,5000,$5,'completed', $6)`, [T, B, tk, EOD.svc, tech, at]);
        }
        // 24 older, already-closed follow-ups for paging (history only)
        for (let j = 0; j < 24; j++) {
          await q(`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, customer_name_snapshot, technician_name_snapshot,
                     customer_app_user_id, status, suggested_message, skip_reason, created_at, customer_phone_snapshot)
                   values ($1,$2,($3::date - $4::int),$5,$6,gen_random_uuid(),gen_random_uuid(),'Gus Older','Bo Two',$7,'skipped','Thanks for coming in!','client asked not to be texted', now() - make_interval(days => $4), '(609) 555-0206')`,
            [T, B, today, 2 + j, EOD.gus, EOD.t2, pid(106)]);
        }
        return { seeded: true, today, tz, ids: EOD };
      }
      if (sp.get('clock')) {
        const [h, m] = String(sp.get('clock')).split(':').map(Number);
        const at = (await q(`select ((now() at time zone $1)::date + make_time($2, $3, 0)) at time zone $1 as at`, [tz, h, m])).rows[0].at;
        const r = await svc.runDueBranches(new Date(at));
        const run = (await q(`select business_date::text as d, run_status, created_count, candidates_count, excluded_count, exclusions_json from daily_follow_up_generation_runs where tenant_id = $1 and branch_id = $2 order by updated_at desc limit 1`, [T, B])).rows[0] ?? null;
        return { at: new Date(at).toISOString(), ...r, run };
      }
      if (sp.get('expire')) return svc.expireStaleTasks(new Date(Date.now() + 25 * 3600_000));
      if (sp.get('workers')) {
        await q(`insert into scheduler_runs (name, last_started_at, last_finished_at, last_outcome, runs, failures, skipped, every_ms, updated_at) values ('followups.run_due', now(), now(), 'ok', 12, 0, 0, 300000, now()), ('followups.expire_stale', now(), now(), 'ok', 12, 0, 0, 300000, now())
                 on conflict (name) do update set updated_at = now(), last_outcome = 'ok', last_finished_at = now()`);
        return { workers: true };
      }
      if (sp.get('approval')) { await repo.saveSettings({ tenantId: T, branchId: B, userId: EOD.u1 }, { requireManagerApproval: sp.get('approval') === '1' }); return { approval: sp.get('approval') === '1' }; }
      if (sp.get('tech')) {
        // tech=<customer key>: that customer's pending task with technician 1. Never "first pending by created_at" —
        // one generation run creates every task in ONE transaction, so created_at ties and the pick was arbitrary
        // (that is what made "Finn already got one today" fail on some runs).
        const who = EOD[String(sp.get('tech'))];
        if (!who) return { submitted: null, error: 'tech=<customer key>' };
        const id = (await q(`select id from service_follow_up_tasks where tenant_id = $1 and technician_id = $2 and customer_id = $3 and status = 'pending' order by created_at, id limit 1`, [T, EOD.t1, who])).rows[0]?.id;
        if (!id) return { submitted: null };
        const v = await svc.techSend({ tenantId: T, branchId: B, userId: EOD.u1, role: 'TECHNICIAN' }, id, 'Hi! Thanks for coming in today — use the cuticle oil tonight.');
        return { submitted: id, status: v.status };
      }
      if (sp.get('state')) {
        const tasks = (await q(`select status, count(*)::int as n from service_follow_up_tasks where tenant_id = $1 and branch_id = $2 and deleted_at is null and technician_id = any($3::uuid[]) group by status order by status`, [T, B, [EOD.t1, EOD.t2]])).rows;
        const deleted = (await q(`select count(*)::int as n from service_follow_up_tasks where tenant_id = $1 and deleted_at is not null and technician_id = any($2::uuid[])`, [T, [EOD.t1, EOD.t2]])).rows[0].n;
        const msgs = (await q(`select count(*)::int as n from customer_notifications where tenant_id = $1 and type = 'service_follow_up' and customer_id = any($2::uuid[])`, [T, PEOPLE.map(([k]) => EOD[k])])).rows[0].n;
        const alerts = (await q(`select count(*)::int as n from technician_notifications where tenant_id = $1 and type = 'daily_followup_ready' and technician_id = any($2::uuid[])`, [T, [EOD.t1, EOD.t2]])).rows[0].n;
        const runs = (await q(`select count(*)::int as n from daily_follow_up_generation_runs where tenant_id = $1 and branch_id = $2`, [T, B])).rows[0].n;
        const settings = await repo.settingsFor(T, B);
        return { tasks, deleted, messages: msgs, techAlerts: alerts, runs, settings, tz };
      }
      return { ok: true };
    },
  };
}
